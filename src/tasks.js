const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

class BasysTaskProvider {
  constructor(project) {
    this.project = project;
  }

  provideTasks() {
    const basysPath = path.join(this.project.dir, 'node_modules', '.bin', 'basys');
    const tasks = [];
    for (const appName of this.project.appNames || []) {
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

function isTask(task, name, appName = null) {
  const def = task.definition;
  return def.type === 'basys' && def.name === name && (!appName || def.appName === appName);
}

function findTaskExecution(name, appName = null) {
  return vscode.tasks.taskExecutions.filter(taskExec => isTask(taskExec.task, name, appName))[0];
}

function taskCommands(project, treeDataProvider, reporter) {
  return [
    vscode.commands.registerCommand('basys.start-dev-server', async appName => {
      reporter.sendTelemetryEvent('start-dev-server');

      if (!appName) {
        appName = await selectApp(project.appNames);
      }

      if (appName) {
        vscode.tasks.fetchTasks().then(tasks => {
          vscode.tasks.executeTask(
            tasks.filter(task => isTask(task, 'start-dev-server', appName))[0],
          );
          treeDataProvider.refresh();
        });
      }
    }),

    vscode.commands.registerCommand('basys.stop-dev-server', async appName => {
      reporter.sendTelemetryEvent('stop-dev-server');

      if (!appName) {
        appName = await selectApp(project.appNames);
      }

      if (appName) {
        const taskExec = findTaskExecution('start-dev-server', appName);
        if (taskExec) taskExec.terminate();
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
    const spinnerIconPath = path.join(__dirname, '..', 'assets', 'spinner.svg');
    if (element) {
      if (element.id.startsWith('app-')) {
        // BUG: look at TreeItem.contextValue
        const appName = element.id.substr(4);
        const children = [];
        const taskExec = findTaskExecution('start-dev-server', appName);
        if (this.project.devServers[appName]) {
          // Allow to stop dev server if it was started from VSCode
          if (taskExec) {
            children.push({
              label: 'Stop dev server',
              command: {
                command: 'basys.stop-dev-server',
                arguments: [appName],
              },
            });
          }

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
            iconPath: taskExec ? spinnerIconPath : null,
          });
        }

        children.push({
          label: 'Build',
          command: {
            command: 'basys.build',
            arguments: [appName],
          },
        });

        // Show item only if there are end-to-end tests
        const e2eTestsDir = path.join(this.project.dir, 'tests', 'e2e');
        if (fs.existsSync(e2eTestsDir) && fs.readdirSync(e2eTestsDir).length > 0) {
          children.push({
            label: 'Run end-to-end tests',
            command: {
              command: 'basys.e2e-test',
              arguments: [appName],
            },
          });
        }

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

      // Show item only if there are unit tests
      const unitTestsDir = path.join(this.project.dir, 'tests', 'unit');
      if (fs.existsSync(unitTestsDir) && fs.readdirSync(unitTestsDir).length > 0) {
        elements.push({
          label: 'Run unit tests',
          command: {
            command: 'basys.unit-test',
          },
        });
      }

      elements.push({
        label: 'Lint',
        command: {
          command: 'basys.lint',
        },
      });

      // BUG: command for starting app builder?

      return elements;
    }
  }
}

module.exports = {BasysTaskProvider, BasysTreeDataProvider, taskCommands};
