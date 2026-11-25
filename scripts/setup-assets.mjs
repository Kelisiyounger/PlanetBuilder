#!/usr/bin/env node
/**
 * 把 reference/messenger.abeto.co/assets 接到 static/messenger。
 *
 * 为什么需要这一步：
 *   仓库里的 static/messenger 是一个 git symlink。Windows 默认
 *   core.symlinks=false，checkout 时会写成一个“内容是目标路径”的文本文件，
 *   Vite 不会把它当目录，所有 /messenger/... 请求都会 404。
 *
 * 用法：
 *   corepack pnpm setup:assets
 *
 * Windows 上创建的是 junction（不需要管理员权限）；其它平台创建目录 symlink。
 */

import { access, lstat, mkdir, readFile, readlink, symlink, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TARGET = join(ROOT, 'reference', 'messenger.abeto.co', 'assets');
const LINK = join(ROOT, 'static', 'messenger');

/** 相对 TARGET 的关键文件，用来确认链接指向的是完整资产目录。 */
const REQUIRED = [
	'images/atlas.png',
	'images/clouds_noise_64.ktx2',
	'geometries/planets/present/intro/planet.drc',
	'libs/basis/basis_transcoder.js'
];

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	console.log(`仓库：${ROOT}`);
	console.log(`目标：${TARGET}`);
	console.log(`链接：${LINK}\n`);

	if (!(await exists(TARGET))) {
		console.error('缺少参考资产目录。');
		console.error('请先让 reference/messenger.abeto.co/assets 存在（仓库应包含它）。');
		console.error('如果这是一个不完整 clone，可运行 corepack pnpm reference:download 重新下载。');
		process.exit(1);
	}

	const missing = [];
	for (const relative of REQUIRED) {
		if (!(await exists(join(TARGET, relative)))) missing.push(relative);
	}
	if (missing.length > 0) {
		console.error('参考资产不完整，缺少：');
		for (const relative of missing) console.error(`  - ${relative}`);
		console.error('请先运行 corepack pnpm reference:download 或重新 clone。');
		process.exit(1);
	}

	let info = null;
	try {
		info = await lstat(LINK);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}

	if (info) {
		if (info.isSymbolicLink()) {
			const current = await readlink(LINK).catch(() => '');
			const resolved = resolve(dirname(LINK), current);
			if (resolved === TARGET) {
				console.log(`已就绪：static/messenger → ${current}`);
			} else {
				console.log(`链接指向 ${current}，与目标不一致，重建。`);
				await unlink(LINK);
				info = null;
			}
		} else if (info.isDirectory()) {
			// Junction 在部分 Node 版本上会被当成目录；只要关键文件能读到就认为可用。
			console.log('static/messenger 已是目录，检查内容…');
			for (const relative of REQUIRED) {
				if (!(await exists(join(LINK, relative)))) {
					console.error(`目录存在但缺少 ${relative}。请删除 static/messenger 后重跑本脚本。`);
					process.exit(1);
				}
			}
			console.log('已就绪：static/messenger 是一个可用目录。');
			printNextSteps();
			return;
		} else if (info.isFile()) {
			const content = (await readFile(LINK, 'utf8')).trim();
			if (content.length > 0 && content.length < 512 && !content.includes('\n')) {
				console.log(`删除 git 检出的 symlink 文本文件：${content}`);
				await unlink(LINK);
				info = null;
			} else {
				console.error('static/messenger 是普通文件且内容不像链接目标，拒绝删除。');
				console.error('请手动检查这个文件后重试。');
				process.exit(1);
			}
		}
	}

	if (!info) {
		try {
			await mkdir(dirname(LINK), { recursive: true });
			await symlink(TARGET, LINK, process.platform === 'win32' ? 'junction' : 'dir');
			console.log(
				`已创建${process.platform === 'win32' ? ' junction' : ' symlink'}：static/messenger → ${TARGET}`
			);
		} catch (error) {
			console.error(`创建链接失败：${error.message}`);
			console.error('Windows 可手动执行：');
			console.error('  cmd /c mklink /J "static\\messenger" "reference\\messenger.abeto.co\\assets"');
			process.exit(1);
		}
	}

	for (const relative of REQUIRED) {
		if (!(await exists(join(LINK, relative)))) {
			console.error(`链接创建后仍读不到 ${relative}，请检查链接目标。`);
			process.exit(1);
		}
	}

	console.log('\n资产检查通过。');
	printNextSteps();
}

function printNextSteps() {
	console.log('启动开发服务器：');
	console.log('  corepack pnpm dev');
	console.log('\n直达场景：');
	console.log('  http://localhost:5173/?mode=intro');
	console.log('  http://localhost:5173/?mode=walk');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
