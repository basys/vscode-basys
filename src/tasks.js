const path = require('path');
const vscode = require('vscode');

class BasysTaskProvider {
  constructor(project) {
    this.appNames = project.appNames || [];
  }

  provideTasks() {
    const basysPath = path.join('node_modules', '.bin', 'basys');
    const tasks = [];
    for (const appName of this.appNames) {
      tasks.push(
        new vscode.Task(
          {type: 'basys', name: 'start-dev-server', appName},
          vscode.workspace.WorkspaceFolder,
          `${appName} app - start dev server`,
          'Basys',
          // BUG: pass cwd and other arguments (in all commands)
          new vscode.ShellExecution(`${basysPath} dev ${appName}`),
          [],
        ),
        // BUG: task.presentationOptions = {panel: vscode.TaskPanelKind.Dedicated};
        // BUG: provide task.isBackground?

        new vscode.Task(
          {type: 'basys', name: 'build', appName},
          vscode.workspace.WorkspaceFolder,
          `${appName} app - build`,
          'Basys',
          new vscode.ShellExecution(`${basysPath} build ${appName}`),
          [],
        ),

        new vscode.Task(
          {type: 'basys', name: 'e2e-test', appName},
          vscode.workspace.WorkspaceFolder,
          `${appName} app - run end-to-end tests`,
          'Basys',
          new vscode.ShellExecution(`${basysPath} test:e2e ${appName}`),
          [],
        ),
      );
    }

    tasks.push(
      new vscode.Task(
        {type: 'basys', name: 'unit-test'},
        vscode.workspace.WorkspaceFolder,
        'Run unit tests',
        'Basys',
        new vscode.ShellExecution(`${basysPath} test:unit`),
        [],
      ),

      new vscode.Task(
        {type: 'basys', name: 'lint'},
        vscode.workspace.WorkspaceFolder,
        'Lint',
        'Basys',
        new vscode.ShellExecution(`${basysPath} lint`),
        [],
      ),
    );

    return tasks;
  }

  resolveTask(task) {}
}

async function selectApp(appNames) {
  if (!appNames) {
    // BUG: a button for opening basys.json for editing
    vscode.window.showWarningMessage("basys.json couldn't be parsed", {modal: true});
  } else if (appNames.length === 0) {
    // BUG: a button to run the command for creating a new app
    vscode.window.showWarningMessage('This project has no apps', {modal: true});
  } else if (appNames.length === 1) {
    return appNames[0];
  } else {
    const res = await vscode.window.showQuickPick(
      appNames.map(name => ({label: name, value: name})),
      {
        ignoreFocusOut: true,
        placeHolder: 'Select the app',
      },
    );
    if (res) return res.value;
  }
}

function taskCommands(project, reporter) {
  return [
    vscode.commands.registerCommand('basys.start-dev-server', async appName => {
      reporter.sendTelemetryEvent('start-dev-server');

      if (!appName) {
        appName = await selectApp(project.appNames);
      }

      if (appName) {
        vscode.commands.executeCommand(
          'workbench.action.tasks.runTask',
          `Basys: ${appName} app - start dev server`,
        );
      }
    }),

    vscode.commands.registerCommand('basys.stop-dev-server', async appName => {
      reporter.sendTelemetryEvent('stop-dev-server');

      if (!appName) {
        appName = await selectApp(project.appNames);
      }

      if (appName) {
        // BUG: fix it
        vscode.commands.executeCommand(
          'workbench.action.tasks.terminate',
          `Basys: ${appName} app - start dev server`,
        );
      }
    }),

    vscode.commands.registerCommand('basys.open-app', async appName => {
      reporter.sendTelemetryEvent('open-app');

      const info = project.devServers[appName];
      if (!info) return; // BUG: show error

      await vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.parse(`http://${info.host}:${info.port}`),
      );
    }),

    vscode.commands.registerCommand('basys.build', async appName => {
      reporter.sendTelemetryEvent('build');

      if (!appName) {
        appName = await selectApp(project.appNames);
      }

      if (appName) {
        vscode.commands.executeCommand(
          'workbench.action.tasks.runTask',
          `Basys: ${appName} app - build`,
        );
      }
    }),

    vscode.commands.registerCommand('basys.unit-test', () => {
      reporter.sendTelemetryEvent('unit-test');
      vscode.commands.executeCommand('workbench.action.tasks.runTask', 'Basys: Run unit tests');
    }),

    vscode.commands.registerCommand('basys.e2e-test', async appName => {
      reporter.sendTelemetryEvent('e2e-test');

      if (!appName) {
        appName = await selectApp(project.appNames);
      }

      if (appName) {
        vscode.commands.executeCommand(
          'workbench.action.tasks.runTask',
          `Basys: ${appName} app - run end-to-end tests`,
        );
      }
    }),

    vscode.commands.registerCommand('basys.lint', () => {
      reporter.sendTelemetryEvent('lint');
      vscode.commands.executeCommand('workbench.action.tasks.runTask', 'Basys: Lint');
    }),
  ];
}

class BasysTreeDataProvider {
  constructor(project) {
    this.project = project;
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
    project.onProjectChange(evt => {
      if (evt === 'dev-server') this.refresh();
    });
  }

  refresh() {
    this._onDidChange.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (element) {
      if (element.id.startsWith('app-')) {
        // BUG: look at TreeItem.contextValue
        // BUG: depends on the status of running tasks, icons
        const appName = element.id.substr(4);
        const children = [];

        if (this.project.devServers[appName]) {
          children.push({
            label: 'Stop dev server',
            command: {
              command: 'basys.stop-dev-server',
              arguments: [appName],
            },
          });

          children.push({
            label: 'Open in browser',
            command: {
              command: 'basys.open-app',
              arguments: [appName],
            },
          });
        } else {
          children.push({
            label: 'Start dev server',
            command: {
              command: 'basys.start-dev-server',
              arguments: [appName],
            },
          });
        }

        children.push(
          {
            label: 'Build',
            command: {
              command: 'basys.build',
              arguments: [appName],
            },
          },
          {
            label: 'Run end-to-end tests',
            command: {
              command: 'basys.e2e-test',
              arguments: [appName],
            },
          },
        );

        return children;
      }
    } else {
      // Root elements
      const elements = [];
      for (const appName of this.project.appNames) {
        elements.push({
          id: `app-${appName}`,
          label: `${appName} app`,
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        });
      }

      elements.push(
        {
          label: 'Run unit tests',
          command: {
            command: 'basys.unit-test',
          },
        },
        {
          label: 'Lint',
          command: {
            command: 'basys.lint',
          },
        },
      );

      // BUG: command for starting app builder?

      return elements;
    }
  }
}

module.exports = {BasysTaskProvider, BasysTreeDataProvider, taskCommands};