const fs = require('fs');
const JSON5 = require('json5');
const path = require('path');
const vscode = require('vscode');

class Project {
  constructor(projectDir) {
    this.dir = projectDir;
    this._eventEmitter = new vscode.EventEmitter();
    this.onProjectChange = this._eventEmitter.event;

    this.getConfig();

    // Track dev-server.json files to have the status of dev servers running
    this.updateDevServer();
    for (const appName of this.appNames || []) {
      fs.watchFile(
        path.join(this.dir, '.basys', appName, 'dev', 'dev-server.json'),
        {interval: 1000},
        () => this.updateDevServer(),
      );
    }
  }

  getConfig() {
    try {
      const basysJson = fs.readFileSync(path.join(this.dir, 'basys.json'), 'utf8');
      this.config = JSON5.parse(basysJson);
      this.appNames = Object.keys(this.config.apps);
    } catch (e) {
      this.config = null;
      this.appNames = null;
    }
  }

  updateDevServer() {
    this.devServers = {};
    for (const appName of this.appNames || []) {
      try {
        const info = JSON.parse(
          fs.readFileSync(path.join(this.dir, '.basys', appName, 'dev', 'dev-server.json'), 'utf8'),
        );
        process.kill(info.pid, 0);
        this.devServers[appName] = info;
      } catch (e) {
        continue;
      }
    }
    this._eventEmitter.fire('dev-server');
  }
}

module.exports = {Project};
