const fs = require('fs');
const path = require('path');
const {
  commands,
  languages,
  window,
  workspace,
  Range,
  RelativePattern,
  TextEdit,
  Uri,
} = require('vscode');
const {LanguageClient} = require('vscode-languageclient');

let terminal = null;

class PrettierEditProvider {
  provideDocumentFormattingEdits(document) {
    // BUG: use document.fileName to calculate it (use .stylelintignore)
    const fileIsIgnored = false;
    if (!document.isUntitled && fileIsIgnored) return;
    if (!['css', 'less', 'scss'].includes(document.languageId)) return;

    let text;
    try {
      text = require('prettier').format(document.getText(), {
        printWidth: 100,
        tabWidth: 2,
        filepath: document.fileName,
      });
    } catch (e) {
      // BUG: report the error
      return;
    }

    const lastLineId = document.lineCount - 1;
    const range = new Range(0, 0, lastLineId, document.lineAt(lastLineId).text.length);
    return [TextEdit.replace(range, text)];
  }
}

exports.activate = async function(context) {
  // Create project command
  context.subscriptions.push(
    commands.registerCommand('basys.createProject', async () => {
      const template = await window.showQuickPick(
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

      const dirObj = await window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select folder',
      });
      if (!dirObj || !dirObj[0]) return;

      await require('basys-cli/utils').initProject(
        {name: template.value, dest: dirObj[0].path, vscode: true},
        false,
      );
      await commands.executeCommand('vscode.openFolder', Uri.parse(dirObj[0].path));
    }),
  );

  let basysFolder;
  for (const wf of workspace.workspaceFolders || []) {
    if (fs.existsSync(path.join(wf.uri.path, 'basys.json'))) {
      basysFolder = wf.uri.path;
      break;
    }
  }
  if (!basysFolder) return;

  // Project overview page
  context.subscriptions.push(
    workspace.registerTextDocumentContentProvider('basys', {
      provideTextDocumentContent(uri) {
        if (uri.authority === 'overview') {
          // BUG: add styles, move them to a separate file
          // BUG: show a link to the website+docs, logo
          // BUG: show project title extracted from package.json?
          return `
        <style></style>
        <body>
          <h1 class="caption">Welcome to Basys!</h1>
          <a href="command:basys.configure">Edit project configuration</a>
          <br>
          <a href="http://basys.io/docs/configuration">See documentation</a>
        </body>`;
        }
      },
    }),
  );

  context.subscriptions.push(
    commands.registerCommand('basys.overview', () =>
      commands.executeCommand(
        'vscode.previewHtml',
        Uri.parse('basys://overview'),
        1,
        'Basys: Project overview',
      ),
    ),
  );

  context.subscriptions.push(
    commands.registerCommand('basys.configure', () => {
      window.showTextDocument(Uri.file(path.join(basysFolder, 'basys.json')));
    }),
  );

  if (!terminal) terminal = window.createTerminal('basys');
  terminal.show();
  terminal.sendText(`cd "${basysFolder.replace(/\\/g, '\\\\')}"`); // Replace single backslash with double backslash

  const isNewProject = !fs.existsSync(path.join(basysFolder, 'node_modules'));
  if (isNewProject) {
    await commands.executeCommand('basys.overview');
    terminal.sendText('npm install');
  }

  // BUG: `basys dev` should work in this console (even if global package is not installed)
  // BUG: what if there is more than 1 app?
  // BUG: launch the dev server and show a notification (only after npm install is finished if `isNewProject`)
  terminal.sendText(`${path.join('node_modules', '.bin', 'basys')} dev`);

  // Style linting
  const serverPath = path.join(__dirname, 'stylelint-server.js');
  const client = new LanguageClient(
    'stylelint',
    {
      run: {
        module: serverPath,
      },
      debug: {
        module: serverPath,
        options: {
          execArgv: ['--nolazy', '--debug=6004'],
        },
      },
    },
    {
      // BUG: also format unsaved files
      documentSelector: ['css', 'less', 'scss'],
      synchronize: {
        configurationSection: 'stylelint',
        fileEvents: workspace.createFileSystemWatcher(
          '{.stylelintrc{,.js,.json},stylelint.config.js}',
        ),
      },
    },
  );
  context.subscriptions.push(client.start());

  // Style formatting
  const editProvider = new PrettierEditProvider();
  const languageSelector = [];
  for (const lang of ['css', 'less', 'scss']) {
    languageSelector.push({language: lang, scheme: 'untitled'});
    for (const workspaceFolder of workspace.workspaceFolders || []) {
      languageSelector.push({
        language: lang,
        pattern: new RelativePattern(workspaceFolder, 'assets/**/*.{css,less,scss}'),
      });
    }
  }
  let formatterHandler = languages.registerDocumentFormattingEditProvider(
    languageSelector,
    editProvider,
  );
  context.subscriptions.push({
    dispose() {
      if (formatterHandler) formatterHandler.dispose();
      formatterHandler = undefined;
    },
  });

  window.onDidCloseTerminal(closedTerminal => {
    if (terminal === closedTerminal) {
      terminal = null;
    }
  });
};

exports.deactivate = function() {
  if (terminal) terminal.dispose();
};
