const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const {LanguageClient} = require('vscode-languageclient');

class PrettierEditProvider {
  constructor(project) {
    this.project = project;
  }

  provideDocumentFormattingEdits(document) {
    // BUG: use document.fileName to calculate it (use .stylelintignore)
    const fileIsIgnored = false;
    if (!document.isUntitled && fileIsIgnored) return;
    if (!['css', 'less', 'scss'].includes(document.languageId)) return;

    const prettierPath = path.join(this.project.dir, 'node_modules', 'prettier');
    if (!fs.existsSync(prettierPath)) return;

    let text;
    try {
      text = require(prettierPath).format(document.getText(), {
        printWidth: 100,
        tabWidth: 2,
        filepath: document.fileName,
      });
    } catch (e) {
      // BUG: report the error
      return;
    }

    const lastLineId = document.lineCount - 1;
    const range = new vscode.Range(0, 0, lastLineId, document.lineAt(lastLineId).text.length);
    return [vscode.TextEdit.replace(range, text)];
  }
}

// Implement "Format document" command for styles
function styleDocumentFormattingEditProvider(project) {
  const editProvider = new PrettierEditProvider(project);
  const languageSelector = [];
  for (const lang of ['css', 'less', 'scss']) {
    languageSelector.push({language: lang, scheme: 'untitled'});
    for (const workspaceFolder of vscode.workspace.workspaceFolders || []) {
      languageSelector.push({
        language: lang,
        pattern: new vscode.RelativePattern(workspaceFolder, 'assets/**/*.{css,less,scss}'),
      });
    }
  }
  return vscode.languages.registerDocumentFormattingEditProvider(languageSelector, editProvider);
}

function startStylelintServer(project) {
  const fsWatcher = vscode.workspace.createFileSystemWatcher(
    path.join(project.dir, '{.stylelintrc,.stylelintrc.js,.stylelintrc.json,.stylelint.config.js}'),
  );

  // When stylelint npm package is changed notify the language server to reload it.
  // createFileSystemWatcher() ignores files inside node_modules.
  fs.watchFile(
    path.join(project.dir, 'node_modules', 'stylelint', 'lib', 'index.js'),
    (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        fsWatcher._onDidChange.fire('stylelint');
      }
    },
  );

  const serverPath = path.join(__dirname, 'stylelint-server.js');
  const client = new LanguageClient(
    'stylelint',
    'Stylelint Server',
    {
      run: {
        module: serverPath,
        options: {
          cwd: project.dir,
        },
      },
      debug: {
        module: serverPath,
        options: {
          cwd: project.dir,
          execArgv: ['--nolazy', '--debug=6004'],
        },
      },
    },
    {
      // BUG: also format unsaved files?
      documentSelector: ['css', 'less', 'scss'],
      synchronize: {
        configurationSection: 'stylelint',
        fileEvents: fsWatcher,
      },
    },
  );
  return client.start();
}

module.exports = {startStylelintServer, styleDocumentFormattingEditProvider};
