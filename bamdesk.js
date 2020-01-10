const cmdPromise = require('cmd-promise')
const tmp = require('tmp');
const fs = require('fs');
const os = require('os');
const { app } = require('electron')
const path = require('path')
const log = require('electron-log');
const request = require('request')
const isDev = require('electron-is-dev');
const config = isDev ? require(path.join(__dirname, 'config-dev.json')) : require(path.join(__dirname, 'config.json'));
const { BrowserWindow } = require('electron')
const machineid = require('node-machine-id');
const Store = require('electron-store');
const { spawn } = require('child_process');
const ps = require('ps-node');
var commandExists = require('command-exists');

let process;
let currentDevice;

/* make sure extacly a single instance of bamdesk (Dankort device driver) is running.
Internet/usb disconnection etc. will kill any running instance.
This will restart bamdesk client if such event occour */
async function keepAlive(device) {
	if (!process) {
		/* initiaite */
		try {
			/* kill any uninstall any legacy bamdesk, if a device is select using the now method */
			if (device) {
				await killLegacyBamdesk();
				renameLegacyBamdesk();
			}
		} catch (e) {
			/* no legacy bamdesk was running, just continue */
		}
		currentDevice = device;
		await run();
	} else { /* change device state */
		/* device == null means the user has deselected the device in settings. Kill current instance */
		if (device === null) {
			log.info('Device as been deselected by user', 'kill any running instance');
			process.kill();
		/* device has been change by user, kill currenct instance. It will state again with the new device since device is non-null */
		} else if (device.id != currentDevice.id) {
			/* if user has changed device in settings. */
			log.info('Device changed', 'kill any running instance');
			process.kill();
		}
		currentDevice = device;
	}
}

/* start bamdesk if not running */
async function run() {

	if (!currentDevice) {
		log.info(`No device selected`);
		process = null;
		return;
	}

	const running = await isBamdeskRunning();

	if (running) {
		log.info(`bamdesk already running`);
		return false;
	}
	const hasMono = await mustInstallMono();

	if (hasMono) {
		/* on mac/linux the user must install mono manually */
		/* @todo install mono */
		return false;
	}

	log.info('Starting instance', currentDevice);

	const bamdeskExec = path.join(__dirname, 'assets', 'BamdeskMint.exe').replace('app.asar', 'app.asar.unpacked')
	const url = `${config.servicepos_url}/webbackend/index.php`;
	log.info(`Bamdesk exe: ${bamdeskExec}`);
	switch (os.platform()) {
		case 'darwin':
		case 'linux':
			process = spawn('mono', [bamdeskExec, url, currentDevice.id, currentDevice.secretkey]);
			break;
		case 'win32':
			process = spawn(bamdeskExec, [url, currentDevice.id, currentDevice.secretkey]);
			break;
		default:
			log.error('Platform not supported.');
			return;
	}

	process.stdout.on('data', (data) => {
		//log.info(`stdout: ${data}`);
	});

	process.stderr.on('data', (data) => {
		log.error(`stdout: ${data}`);
	});

	/* restart bamdesk if it exits. USB connection lost, kill() due to change of deviceid, etc. */
	process.on('exit', (data) => {
		log.info('Bamdesk exit');
		run();
	});
}

function killLegacyBamdesk() {
	let cmd;
	switch (os.platform()) {
		case 'darwin':
		case 'linux':
			cmd = 'killall mono';
			break;
		case 'win32':
			cmd = 'taskkill /im Bamdesk.exe';
			break;
		default:
			throw new Exception('Platform not supported.');
	}
	log.info(`Kill any legacy bamdesk ${cmd}`);
	return cmdPromise(cmd).catch()
}

function isBamdeskRunning() {
	let cmd;
	switch (os.platform()) {
		case 'darwin':
		case 'linux':
			cmd = 'ps';
			break;
		case 'win32':
			cmd = 'tasklist';
			break;
		default:
			throw new Exception('Platform not supported.');
	}
	return cmdPromise(cmd).then(out => {
		log.info(`ps: ${out.stdout}`);
		return out.stdout.indexOf('BamdeskMint.exe') > -1;
	});
}

function mustInstallMono() {
	if (os.platform() == 'win32') {
		return new Promise((resolve, reject) => {
			resolve(false);
		});
	}
	return new Promise((resolve, reject) => {
		commandExists('mono', function(err, commandExists) {
			resolve(!commandExists);
		});
	});
}


/** expires  */
async function renameLegacyBamdesk() {
	log.info('rename legacy bamdesk');
	try {
		switch (os.platform()) {
			case 'darwin':
				const from = '/Applications/bamdesk';
				const to = '/Applications/bamdesk_legacy';
				fs.renameSync(from, to);
				break;
			case 'win32':
				const cmd = `schtasks /CHANGE /tn "ServicePOS bamdesk" /DISABLE`;
				await cmdPromise(cmd);
				break;
			default:
				throw new Exception('Platform not supported.');
		}
	} catch (e) {
		log.error('Error remiving legacy bamdesk', e);
	}
}

module.exports = {
	keepAlive
}