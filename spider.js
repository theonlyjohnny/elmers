const Promise = require("bluebird"),
  _ = require("lodash"),
  Path = require("path"),
  cp = require("child_process"),
  fs = Promise.promisifyAll(require("fs")),
  rp = require("request-promise"),
  colors = require("colors");

class Spider {
  constructor(path, options) {
    this.path = path;

    for (let opt in options) {
      this[opt] = options[opt];
    }

    this.addedModules = [];
    this.erroring = [];
    this.good = [];
    this.canUpgrade = [];
    this.savedPackages = {};

    this.managerDict = {
      npm: {
        install: 'npm i',
        add: 'npm i',
        save: 'npm i --save',
        upgrade: 'npm update'
      },
      yarn: {
        install: 'yarn',
        add: 'yarn add',
        save: 'yarn add',
        upgrade: 'yarn upgrade'
      }
    }

    this.manager = 'npm';

    if (fs.existsSync('./yarn.lock')) {
      this.manager = 'yarn';
    }

    this.managerDict = this.managerDict[this.manager];

    this.tries = 0;
    this.childLife = 10 * 1000;

    const initCmd = `rm -rf ./node_modules && ${this.managerDict.install}`;
    console.log(colors.grey(`Clearing node_modules`))
    cp.exec(initCmd, () => {
      console.log(colors.grey('node_modules re-installed from package.json'));
      console.log(colors.cyan(`Crawling ${path} ${this.verbose ? 'in verbose mode' : ''}`));
      this.run(this.path)
    });
  }

  checkUpdates() {
    if (!this.verbose) return;

    const promises = [];
    for (const pkg in this.savedPackages) {
      const opts = {
        method: "GET",
        url: `https://npmjs.org/-/search`,
        json: true,
        qs: {
          text: pkg
        }
      }
      promises.push(rp(opts));
    }

    Promise.map(promises, data => {
        const obj = data.objects[0].package;
        const { name } = obj;
        // console.log(obj, name);
        const latest = obj.version;
        try {
          const version = JSON.parse(fs.readFileSync(Path.resolve(`./node_modules/${name}/package.json`))).version;

          if (version !== latest && parseFloat(version) < parseFloat(latest)) {
            this.canUpgrade.push(name);
          }
        } catch (err) {
          //if for some reason pkg isn't there, fail silently
        }
      })
      .then(() => {
        console.log(colors.cyan(`Packages to upgrade:`), colors.green(this.canUpgrade.length ? this.canUpgrade.join(", ") : 'none'));
      }).then(() => {
        if (this.force) {
          console.log(colors.grey(`Upgrading packages`));
          cp.exec(this.managerDict.upgrade, () => {
            console.log(colors.grey('Packages upgraded'));
          })
        }
      })
  }

  checkFile(path) {
    return new Promise(res => {

      const child = cp.spawn('node', [path])

      let childAlive = true;
      setTimeout(() => {
        if (childAlive) {
          child.kill();
          return res({ path, err: `Process took too long to exit` });
        }
      }, this.childLife)

      if (this.verbose) {
        child.stdout.on('data', data => {
          console.log(`stdout: ${data}`);
        })
      }
      let err = '';

      child.stderr.on('data', data => {
        if (this.verbose) { console.error(`stderr: ${data}`) }
        data = data.toString();
        if (data.indexOf(`Cannot find module`) > -1 || data.indexOf('module.js:457') > -1) {
          try {
            const missing_module = data.split("Cannot find module")[1].split("at")[0].trim();
            if (missing_module.indexOf(".") > -1) {
              this.erroring.push(path)
              return res({
                path,
                err: data
              });
            } else {
              this.addedModules.push(missing_module);
              return res({ path });
            }
          } catch (err) {}
        } else {
          err += data;
        }
      })

      child.on('close', (code) => {
        childAlive = false;
        if (this.verbose) console.log(colors.grey(`Process exited with status code: ${code}`));
        if (code === 1) {
          this.erroring.push(path);
          return res({
            path,
            err: err
          });
        }
        this.good.push(path);
        return res({ path });
      })

    })
  }

  getPaths(origin) {
    console.log(`Getting paths for ${origin}`);
    return fs.readdirAsync(origin)
      .then(contents => contents.filter(path => path.indexOf('node_modules') === -1))
      //no node_modules
      .then(contents => contents.filter(path => {
        const split_path = path.split("/");
        return !split_path[split_path.length - 1].startsWith(".")
          //no dot files
      }))
      .then(files => files.filter(file => file.endsWith('.js')))
      //has to end w/ .js
      .then(files => files.map(file => Path.resolve(origin, file)))
      .then(files => files.map(file => (
        fs.statAsync(file)
        .then(stat => ({
          isDir: stat.isDirectory(),
          fileName: file
        }))
      )))
      .then(promises => Promise.map(promises, info => info.isDir ? this.getPaths(info.fileName) : info.fileName))
      .then(files => _.compact(_.flattenDeep(files)))
  }

  run(path) {
    if (this.tries >= 2) {
      console.log(`We tried 5 times, gonna stop now :(`)
      process.exit(0);
    }

    return fs.statAsync(path)
      .then(stats => {
        const isDir = stats.isDirectory();
        if (isDir) {
          //working on a project
          const package_path = Path.resolve(path, './package.json')
          if (fs.existsSync(package_path)) {
            const data = JSON.parse(fs.readFileSync(package_path));
            this.savedPackages = data.dependencies;
            this.checkUpdates();
          }
          return this.getPaths(path)
            .then(paths => Promise.map(paths, path => this.checkFile(path)))
        } else {
          //working on 1 file
          return this.checkFile(path)
        }
      })
      .then(() => {
        const savedMap = Object.keys(this.savedPackages);
        console.log(colors.cyan(`Installed packages: ${savedMap.length ? colors.green(savedMap.join(", ")) : colors.yellow('Unavailable')}`));
        console.log(colors.cyan(`Fatal crashes from: ${this.erroring.length ? colors.red(this.erroring) : colors.green('none')}`));
        console.log(colors.cyan(`Modules to add: ${this.addedModules.length ? colors.red(this.addedModules) : colors.green('none')}`));
        if (!this.erroring.length && !this.addedModules.length) {
          console.log(colors.green(`Yay! No problems found!`));
        } else if (this.force && this.addedModules.length) {
          const cmd = `${this.managerDict.save} ${this.addedModules.join(" ")}`;
          console.log(colors.cyan(`Installing missing modules...`));
          cp.exec(cmd, () => {
            console.log(colors.green(`Installed succesfully! Re-run Spider to see if you're all good ;)`));
          })
        }
      })
      .catch(err => {
        console.error(`Could not get stats on path -- ${err}`);
        process.exit(1);
      })
  }
}

module.exports = Spider;
