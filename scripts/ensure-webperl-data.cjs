const fs = require('fs-extra');
const path = require('node:path');

const WEBPERL_DIR = path.resolve(__dirname, '../public/core/webperl');
const DATA_FILE = 'emperl.data';

async function ensureWebPerlData() {
	const targetPath = path.join(WEBPERL_DIR, DATA_FILE);
	const sourcePath = path.resolve(
		__dirname,
		'../node_modules/wasm-latex-tools/assets/core/webperl',
		DATA_FILE,
	);
	const loaderPath = path.join(WEBPERL_DIR, 'emperl.js');

	const [loader, sourceData] = await Promise.all([
		fs.readFile(loaderPath, 'utf8'),
		fs.readFile(sourcePath),
	]);
	const expectedSize = Number(
		loader.match(/remote_package_size":(\d+)/)?.[1],
	);

	if (!Number.isSafeInteger(expectedSize) || sourceData.length !== expectedSize) {
		throw new Error(
			'WebPerl assets are incompatible: emperl.data does not match the byte size declared by emperl.js.',
		);
	}

	let targetData;
	try {
		targetData = await fs.readFile(targetPath);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}

	if (targetData?.equals(sourceData)) return;

	await fs.outputFile(targetPath, sourceData);
	console.log('✓ Restored byte-exact WebPerl data image');
}

if (require.main === module) {
	ensureWebPerlData().catch((error) => {
		console.error('❌ Failed to prepare WebPerl data:', error);
		process.exit(1);
	});
}

module.exports = { ensureWebPerlData };
