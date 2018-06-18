const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const TelemetryReporter = require('vscode-extension-telemetry').default;
const {startStylelintServer, styleDocumentFormattingEditProvider} = require('./linting');
const {Project} = require('./project');
const {BasysTaskProvider, BasysTreeDataProvider, taskCommands} = require('./tasks');

let terminal = null;

exports.activate = async function(context) {
  const packageInfo = require('../package.json');
  const reporter = new TelemetryReporter('vscode-basys', packageInfo.version, packageInfo.aiKey);
  context.subscriptions.push(reporter);

  reporter.sendTelemetryEvent('activation');

  // Create project command
  context.subscriptions.push(
    vscode.commands.registerCommand('basys.createProject', async () => {
      reporter.sendTelemetryEvent('create-project');

      const template = await vscode.window.showQuickPick(
        [
          {label: 'Blank project', value: 'basys/basys-starter-project'},
          {label: 'Todo list sample web app', value: 'basys/basys-todomvc'},
        ],
        {
          ignoreFocusOut: true,
          placeHolder: 'Select a starter project',
        },
      );
      if (!template) return;

      const dirObj = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select folder',
      });
      if (!dirObj || !dirObj[0]) return;

      reporter.sendTelemetryEvent('create-project-completed');

      await require('basys-cli/utils').initProject(
        {name: template.value, dest: dirObj[0].fsPath, vscode: true},
        false,
      );
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.parse(dirObj[0].path));
    }),
  );

  let projectDir;
  for (const wf of vscode.workspace.workspaceFolders || []) {
    if (fs.existsSync(path.join(wf.uri.fsPath, 'basys.json'))) {
      projectDir = wf.uri.fsPath;
      break;
    }
  }
  if (!projectDir) return;

  const project = new Project(projectDir);
  if (!project.config) return; // BUG: show error, keep working

  context.subscriptions.push(
    vscode.workspace.registerTaskProvider('basys', new BasysTaskProvider(project)),
  );

  const treeDataProvider = new BasysTreeDataProvider(project);
  Array.prototype.push.apply(
    context.subscriptions,
    taskCommands(project, treeDataProvider, reporter),
  );
  treeDataProvider.refresh();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('basys', treeDataProvider));

  // Project overview page
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('basys', {
      provideTextDocumentContent(uri) {
        if (uri.authority === 'overview') {
          // BUG: use projectDir to extract project info
          // BUG: add styles, move them to a separate file
          // BUG: show a link to the website+docs, logo
          // BUG: show project title extracted from package.json?
          return `
          <style></style>
          <body>
            <h1 class="caption">Welcome to Basys!</h1>
            <a href="command:basys.open-config">Edit project configuration</a>
            <br>
            <a href="http://basys.io/docs/configuration">See documentation</a>
          </body>`;
        }
      },
    }),

    vscode.commands.registerCommand('basys.overview', () => {
      reporter.sendTelemetryEvent('project-overview');

      vscode.commands.executeCommand(
        'vscode.previewHtml',
        vscode.Uri.parse('basys://overview'),
        1,
        'Basys: Project overview',
      );
    }),

    vscode.commands.registerCommand('basys.open-config', () => {
      vscode.window.showTextDocument(vscode.Uri.file(path.join(project.dir, 'basys.json')));
    }),
  );

  const isNewProject = !fs.existsSync(path.join(project.dir, 'node_modules'));
  if (isNewProject) {
    await vscode.commands.executeCommand('basys.overview');

    if (!terminal) terminal = vscode.window.createTerminal('basys');
    terminal.show();
    terminal.sendText(`cd "${project.dir.replace(/\\/g, '\\\\')}"`); // Replace single backslash with double backslash
    terminal.sendText('npm install');

    // Activate Jest extension after `npm install` is finished
    const jestExtension = vscode.extensions.getExtension('Orta.vscode-jest');
    if (jestExtension && jestExtension.isActive) {
      const packageLockPath = path.join(project.dir, 'package-lock.json');
      fs.watchFile(packageLockPath, (curr, prev) => {
        if (curr.size > 0) {
          fs.unwatchFile(packageLockPath);
          vscode.commands.executeCommand('io.orta.jest.start');
        }
      });
    }
  }

  context.subscriptions.push(
    startStylelintServer(project),
    styleDocumentFormattingEditProvider(project),
  );

  vscode.window.onDidCloseTerminal(closedTerminal => {
    if (terminal === closedTerminal) {
      terminal = null;
    }
  });
};

exports.deactivate = function() {
  if (terminal) terminal.dispose();
};
