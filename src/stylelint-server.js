const path = require('path');
const {createConnection, Files, TextDocuments} = require('vscode-languageserver');

const connection = createConnection(process.stdin, process.stdout);
const documents = new TextDocuments();

let lint;

function validate(document) {
  if (!lint) {
    connection.sendDiagnostics({uri: document.uri, diagnostics: []});
    return;
  }

  const options = {
    code: document.getText(),
    codeFilename: Files.uriToFilePath(document.uri),
    syntax: document.languageId !== 'css' ? document.languageId : undefined,
  };
  return lint(options)
    .catch(err => {
      if (
        err.message.startsWith('No configuration provided for') ||
        /No rules found within configuration/.test(err.message)
      ) {
        // If .stylelintrc is not provided use the default Basys stylelint configuration
        return lint(Object.assign(options, {config: {extends: 'stylelint-config-basys'}}));
      }

      return Promise.reject(err);
    })
    .then(({results}) => {
      const invalidOptionWarnings = results[0].invalidOptionWarnings;
      if (invalidOptionWarnings.length !== 0) {
        for (const warning of invalidOptionWarnings) {
          connection.window.showErrorMessage(`stylelint: ${warning.text}`);
        }
        return;
      }

      const diagnostics = results[0].warnings.map(warning => {
        const position = {
          line: warning.line - 1,
          character: warning.column - 1,
        };
        return {
          message: warning.text,
          severity: warning.severity === 'warning' ? 2 : 1,
          source: 'stylelint',
          range: {
            start: position,
            end: position,
          },
        };
      });
      connection.sendDiagnostics({uri: document.uri, diagnostics});
    })
    .catch(err => {
      // https://github.com/stylelint/stylelint/blob/master/lib/utils/configurationError.js
      if (err.code === 78) {
        connection.window.showErrorMessage(`stylelint: ${err.message}`);
        return;
      }

      connection.window.showErrorMessage(err.stack.replace(/\n/g, ' '));
    });
}

function validateAll() {
  for (const document of documents.all()) {
    validate(document);
  }
}

function updateStylelint() {
  const stylelintPath = path.join(process.cwd(), 'node_modules', 'stylelint', 'lib', 'index.js');
  delete require.cache[stylelintPath];
  try {
    lint = require(stylelintPath).lint;
  } catch (e) {
    lint = null;
    connection.console.log('stylelint npm module is not available');
  }
}

connection.onInitialize(() => {
  updateStylelint();
  validateAll();
  return {
    capabilities: {
      textDocumentSync: documents.syncKind,
    },
  };
});
connection.onDidChangeConfiguration(() => validateAll());
connection.onDidChangeWatchedFiles(_change => {
  if (_change.changes[0] && _change.changes[0].uri === 'stylelint') {
    updateStylelint();
  }
  validateAll();
});

documents.onDidChangeContent(event => validate(event.document));
documents.onDidClose(event =>
  connection.sendDiagnostics({
    uri: event.document.uri,
    diagnostics: [],
  }),
);
documents.listen(connection);

connection.listen();
