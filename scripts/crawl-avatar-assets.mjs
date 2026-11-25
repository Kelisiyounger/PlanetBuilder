#!/usr/bin/env node
/**
 * 进入 messenger.abeto.co 的游戏流程，抓取镜像里缺失的按需资产。
 *
 * 重点：
 *   - assets/geometries/avatar/**  玩家角色与换装配件（只在进入游戏后加载）
 *   - *.exr                        环境贴图
 *   - 其它尚未镜像的 geometries / images
 *
 * 已存在的本地文件默认跳过；用 --force 覆盖。
 *
 * 用法：
 *   corepack pnpm reference:crawl-avatar
 *   node scripts/crawl-avatar-assets.mjs --headless
 *   CAPTURE_SECONDS=90 MANUAL_SECONDS=60 node scripts/crawl-avatar-assets.mjs
 *
 * 说明：
 *   - 默认打开可见浏览器，方便你在抓取窗口内手动点开换装界面。
 *   - 脚本只保存响应体，不执行下载到的资产。
 */

import { existsSync } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REFERENCE_ROOT = resolve(join(ROOT, 'reference', 'messenger.abeto.co'));
const SITE = 'https://messenger.abeto.co/';

const args = new Set(process.argv.slice(2));
const headless = args.has('--headless');
const force = args.has('--force');
const captureSeconds = Number(process.env.CAPTURE_SECONDS ?? 45);
const settleMs = Number(process.env.SETTLE_MS ?? 12000);
const manualSeconds = Number(process.env.MANUAL_SECONDS ?? 0);

/** 若浏览器流程没有触发 avatar，最后直接探测这些常见路径。 */
const PROBE_PATHS = [
	...['avatar-bones', 'avatar', 'avatar-idle', 'avatar-run', 'avatar-sprint', 'avatar-air', 'avatar-afk1', 'avatar-afk2', 'avatar-afk3'].map(
		(name) => `assets/geometries/avatar/${name}.drc`
	),
	...[
		'base',
		...Array.from({ length: 7 }, (_, index) => `hair${index + 1}`),
		...Array.from({ length: 9 }, (_, index) => `top${index + 1}`),
		...Array.from({ length: 7 }, (_, index) => `bottom${index + 1}`),
		...Array.from({ length: 7 }, (_, index) => `shoes${index + 1}`)
	].map((name) => `assets/geometries/avatar/accessories/${name}.drc`),
	...Array.from({ length: 5 }, (_, index) => `assets/geometries/planets/present/hitmesh_${index}.drc`),
	...Array.from({ length: 8 }, (_, index) => `assets/geometries/emojis/${index + 1}.drc`)
];

const records = new Map(); // url -> record
const pending = [];

function shouldCapture(url) {
	if (!url.startsWith(`${SITE.replace(/\/$/, '')}/assets/`)) return false;
	const { pathname } = new URL(url);
	if (pathname.endsWith('.exr')) return true;
	if (pathname.endsWith('.js')) return true;
	if (pathname.includes('/geometries/') && pathname.endsWith('.drc')) return true;
	if (pathname.includes('/images/') && pathname.endsWith('.ktx2')) return true;
	if (pathname.includes('/images/') && pathname.endsWith('.icon')) return true;
	if (pathname.includes('/fonts/') && pathname.endsWith('.font')) return true;
	return false;
}

/** SPA 对不存在的资产会返回 index.html + 200，不能当成资产保存。 */
function looksLikeHtml(body) {
	const head = body.subarray(0, 64).toString('utf8').trimStart().toLowerCase();
	return head.startsWith('<!doctype') || head.startsWith('<html');
}

function localPathFor(url) {
	const pathname = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
	if (!pathname.startsWith('assets/')) return null;
	const target = resolve(REFERENCE_ROOT, pathname);
	return target.startsWith(REFERENCE_ROOT + sep) ? target : null;
}

async function saveBody(url, body, via) {
	const record = records.get(url) ?? { url, via, status: null, path: null, bytes: 0, skipped: false, error: null };
	records.set(url, record);

	const target = localPathFor(url);
	if (!target) {
		record.error = 'path outside reference root';
		return;
	}
	record.path = target;
	record.bytes = body.length;
	if (body.length === 0) {
		record.error = 'empty body';
		return;
	}
	if (looksLikeHtml(body)) {
		record.error = 'HTML fallback (asset not found)';
		console.log(`  跳过 HTML 回退：${url}`);
		return;
	}

	if (!force) {
		try {
			await access(target);
			record.skipped = true;
			return;
		} catch {
			// Missing; save it.
		}
	}

	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, body);
	record.saved = true;
	console.log(`  保存 ${body.length.toString().padStart(9)} B  ${url}`);
}

function queueResponse(response) {
	const url = response.url();
	if (!shouldCapture(url) || records.has(url)) return;
	const record = { url, via: 'network', status: response.status(), path: null, bytes: 0, skipped: false, error: null };
	records.set(url, record);

	pending.push(
		(async () => {
			const target = localPathFor(url);
			// 已镜像的文件不下载响应体：进入 present 场景会请求几十个地形 chunk，
			// 全部读进内存没有意义。
			if (target && !force) {
				try {
					await access(target);
					record.path = target;
					record.skipped = true;
					return;
				} catch {
					// Missing; fall through and save it.
				}
			}
			try {
				await saveBody(url, await response.body(), 'network');
			} catch (error) {
				record.error = String(error?.message ?? error);
			}
		})()
	);
}

async function probeMissing(context) {
	console.log('\n探测常见 avatar 路径…');
	for (const path of PROBE_PATHS) {
		const url = new URL(path, SITE).href;
		if (records.has(url)) continue;
		try {
			const response = await context.request.get(url, { failOnStatusCode: false });
			if (response.status() !== 200) {
				console.log(`  ${response.status()} ${path}`);
				continue;
			}
			const body = await response.body();
			console.log(`  200 ${path}`);
			await saveBody(url, body, 'probe');
		} catch (error) {
			console.log(`  失败 ${path}: ${error?.message ?? error}`);
		}
	}
}

async function main() {
	console.log(`打开 ${SITE}`);
	console.log(`模式：${headless ? 'headless' : '可见浏览器'}，捕获窗口 ${captureSeconds}s\n`);

	// Playwright 自带的 Chromium 可能还没下载；优先用系统 Chrome，避免额外安装。
	const systemChrome = [
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
	].find((candidate) => existsSync(candidate));
	const executablePath = process.env.CHROME_PATH || systemChrome;

	const browser = await chromium.launch({
		headless,
		executablePath,
		args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
	});
	console.log(`浏览器：${executablePath ?? 'Playwright bundled Chromium'}`);
	const context = await browser.newContext({
		viewport: { width: 1280, height: 720 },
		locale: 'zh-CN'
	});
	const page = await context.newPage();

	page.on('response', queueResponse);

	try {
		await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
		await page.waitForTimeout(settleMs);

		// 原站的 BEGIN / ENTER 是 3D 按钮，不是 DOM 元素；在画面中部多试几个点。
		console.log('点击画面，尝试进入游戏…');
		for (const [x, y] of [
			[640, 620],
			[640, 600],
			[640, 640],
			[620, 620],
			[660, 620],
			[640, 420],
			[480, 420],
			[320, 420]
		]) {
			await page.mouse.move(x, y);
			await page.waitForTimeout(200);
			await page.mouse.click(x, y);
			await page.waitForTimeout(1200);
		}

		console.log(`等待场景与 avatar 加载 ${captureSeconds}s…`);
		await page.waitForTimeout(captureSeconds * 1000);

		if (!headless && manualSeconds > 0) {
			console.log(
				`\n保留浏览器 ${manualSeconds}s：可以在页面里点开换装/角色界面，网络响应会继续捕获。\n`
			);
			await page.waitForTimeout(manualSeconds * 1000);
		}

		await page.waitForTimeout(1500);
		await Promise.all(pending);
		await probeMissing(context);
	} finally {
		await browser.close();
	}

	const list = [...records.values()].sort((a, b) => a.url.localeCompare(b.url));
	const saved = list.filter((item) => item.saved);
	const skipped = list.filter((item) => item.skipped);
	const failed = list.filter((item) => item.error);

	await mkdir(REFERENCE_ROOT, { recursive: true });
	await writeFile(
		join(REFERENCE_ROOT, 'avatar-capture.json'),
		JSON.stringify(
			{
				capturedAt: new Date().toISOString(),
				source: SITE,
				headless,
				captureSeconds,
				records: list
			},
			null,
			2
		)
	);
	await writeFile(
		join(REFERENCE_ROOT, 'network-urls-avatar.txt'),
		`${list.map((item) => item.url).join('\n')}\n`
	);

	console.log('\n—— 结果 ——');
	console.log(`响应总数：${list.length}`);
	console.log(`新保存：${saved.length}`);
	console.log(`已存在跳过：${skipped.length}`);
	console.log(`失败：${failed.length}`);
	console.log(`清单：${join(REFERENCE_ROOT, 'avatar-capture.json')}`);

	if (saved.length === 0) {
		console.log(
			'\n没有抓到新文件。若目标是 avatar，请重跑并设置 MANUAL_SECONDS=60，' +
				'在浏览器里手动进入游戏/换装界面；或确认站点当前是否仍提供这些路径。'
		);
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
