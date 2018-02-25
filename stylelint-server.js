const {lint} = require('stylelint');
const {createConnection, Files, TextDocuments} = require('vscode-languageserver');

const connection = createConnection(process.stdin, process.stdout);
const documents = new TextDocuments();

function validate(document) {
  const options = {
    code: document.getText(),
    codeFilename: Files.uriToFilePath(document.uri),
    syntax: document.languageId !== 'css' ? document.languageId : undefined,
  };
  return lint(options)
    .catch(function(err) {
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
          // https://github.com/Microsoft/vscode-languageserver-node/blob/v2.6.2/types/src/main.ts#L130-L147
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
      // https://github.com/stylelint/stylelint/blob/8.4.0/lib/utils/configurationError.js#L9
      if (err.code === 78) {
        connection.window.showErrorMessage(`stylelint: ${err.message}`);
        return;
      }

      connection.window.showErrorMessage(err.stack.replace(/\n/g, ' '));
    });
}

function validateAll() {
  return Promise.all(documents.all().map(document => validate(document)));
}

connection.onInitialize(() => {
  validateAll();
  return {
    capabilities: {
      textDocumentSync: documents.syncKind,
    },
  };
});
connection.onDidChangeConfiguration(() => validateAll());
connection.onDidChangeWatchedFiles(() => validateAll());

documents.onDidChangeContent(event => validate(event.document));
documents.onDidClose(event => connection.sendDiagnostics({
  uri: event.document.uri,
  diagnostics: [],
}));
documents.listen(connection);

connection.listen();
