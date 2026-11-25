# Messenger 逆向对照与重构计划

> 状态：草案  
> 日期：2026-11-20（2026-11-25 更新线上采集记录）  
> 适用仓库：PlanetBuilder（package name: `messenger-copy`）  
> 参考对象：<https://messenger.abeto.co/>

本文档记录对原站产物的静态逆向结论、当前仓库的对照盘点、差异分析，以及"重写 vs 调整"的决策与分阶段实施计划。

---

## 0. 摘要

- 原站不是"一个 Three.js 演示"，而是一个**小型自研游戏引擎 + 完整游戏**：双场景编排、独立 2D UI 场景、全局合成与转场、8 个 Web Worker、BVH 胶囊角色物理、批量蒙皮角色、WebSocket 多人、完整音频与任务系统。
- 当前仓库是**高质量的技术切片**：渲染/资产层已经打通（Draco、KTX2、骨骼重建、材质移植），但缺少运行时骨架（场景生命周期、输入、物理、UI）和游戏系统。
- **不建议整体重写**。建议"保留渲染与资产层，重写运行时外壳，再按优先级补系统"。
- 推荐路线为方案 B，预估 3–5 周（单人 + AI 辅助，15–25 人日），分 P0–P6 七个阶段，P7（多人）可选。

### 0.1 2026-11-25 线上更新记录

- 入口 bundle 已更新：`webgl-C4v7tvuW.js` → `webgl-CS4l6lxD.js`，`App3D-BLRWK1h9.js` → `App3D-DwM1eiaC.js`。旧 bundle 仍保留在镜像中，作为 2026-06 快照。
- 新增资产（已抓取到 `reference/`）：
  - `geometries/planets/present/hitmesh_0..4.drc`（碰撞代理网格）
  - `geometries/planets/present/full-lod-{1,2,3}_{0..9}.drc`（地形 LOD）
  - `geometries/planets/present/grass.drc`、`butterflies.drc`
  - `geometries/avatar/**`（玩家角色、动画、默认装扮与全部配件）
  - `geometries/emojis/1..10.drc`
- `avatar-walk.drc` 在线上已不存在，玩家的移动循环使用 `avatar-run.drc`。
- 默认装扮：`accessories/base` + `hair1` + `top9` + `bottom6` + `shoes2`。
- 抓取清单：`reference/messenger.abeto.co/avatar-capture.json`。

### 0.2 2026-11-25 实施记录

- P0 完成：`pnpm setup:assets` 修复 `static/messenger` junction，四个模式可运行。
- 主语言切换为简体中文，隐藏语言切换器（i18n 结构保留）。
- 抓取并接入线上 avatar：`avatar-run` 作为移动循环，默认装扮 `base + hair1 + top9 + bottom6 + shoes2` 合并为单个蒙皮网格。
- 修复"金属质感"：保留 `.drc` 自带的硬边法线（`ensureNormals`），atlas 标记 `SRGBColorSpace`；所有材质的光照法线改为世界空间（此前 view-space normal 与 world-space 光源混用，光照会随相机漂移）。
- 新增 `src/lib/messenger/outline.ts`：移植原站 `outlines` pass（face id + depth + normal 五采样、断线轮廓、距离衰减），已接入 intro / gameplay / npcs / walk。
- 描边选择性：info pass 写入原站的 `outlineContribution` 遮罩（`sinenoise1(localPos * 4 + surfaceId * ...)` + `step(0.47, ...)`），只绘制部分线段；阴影过渡收窄到 `smoothstep(0.2, 0.4)`。
- 描边外观：灰色 `#555b60`、粗细 3、时间驱动的轻微抖动；info pass 只渲染不透明物体；地形用负 alpha 标记，关闭逐面 ID 项，只保留轮廓深度，避免每个面都变成点状划痕。
- 地形属性：改用 `loadDracoGeometryWithRig` + `splitBatchedGeometry` 保留 `surfaceId` / `elementId`，再按 chunk 合并，mesh 数从 667 降到 23。
- 比例与操作：walk 星球拟合尺寸从 14 调到 40，角色不再像巨人；修正 `frameRight = forward × up`，横向鼠标不再反向。
- 描边分通道：info alpha 改为带符号值（`|a|` 为覆盖率，`sign(a)` 为内部线遮罩），外轮廓保持连续、内部 face-id 线保持断续；透明物体不参与 info pass。
- 待办：把 LUT 合并进 outline shader；present 星球可行走化；任务与交互。

---

## 1. 背景与目标

本仓库定位为学习型复刻：镜像原站资产与 shader，用 SvelteKit + Three.js 重建可运行的场景。当前已有 intro / gameplay / npcs / walk 四个模式，但这些模式是并列的技术演示，而不是一个游戏。

本文档要回答三个问题：

1. 原站到底是怎么组织的？
2. 当前实现与它差在哪，哪些差异是"参数级"，哪些是"架构级"？
3. 下一步应该重写，还是在现有代码上调整？具体怎么排期？

不在本文档范围内：美术资产版权、再分发许可（见 [ATTRIBUTION.md](../ATTRIBUTION.md)）、部署与托管方案。

---

## 2. 方法与证据边界

### 2.1 证据来源

| 来源 | 内容 |
| --- | --- |
| [`reference/messenger.abeto.co/index.html`](../reference/messenger.abeto.co/index.html) | 入口 HTML、module 入口、meta 信息 |
| [`reference/messenger.abeto.co/assets/App3D-BLRWK1h9.js`](../reference/messenger.abeto.co/assets/App3D-BLRWK1h9.js) | 应用主 bundle（约 77k tokens） |
| `reference/messenger.abeto.co/assets/*worker-*.js` | 8 个 Worker 脚本 |
| [`reference/messenger.abeto.co/shaders/`](../reference/messenger.abeto.co/shaders/) | 从 bundle 提取的 193 个 GLSL 文件 |
| [`reference/messenger.abeto.co/manifest.txt`](../reference/messenger.abeto.co/manifest.txt) | 已镜像资产清单 |
| `reference/messenger.abeto.co/network-urls*.txt` | 运行时抓到的网络请求清单 |
| [`reference/messenger.abeto.co/inventory.json`](../reference/messenger.abeto.co/inventory.json) | 抓取元数据（2026-06-16，415 文件 / 13MB） |
| `src/lib/messenger/**` | 当前实现 |

### 2.2 限制

- **未做实时观测**：本次分析基于 2026-06-16 的镜像包。REA 的浏览器采集、JS 应用分析、网络抓包工具在当前权限模式下被安全策略拦截，Bash 亦不可用。因此没有验证线上站是否已更新。
- **未执行原站代码**：所有结论来自静态阅读，不包含运行时行为验证。
- **部分资产缺失**：镜像中没有 `avatar/` 几何体集合与 `.exr` 环境贴图，这两类资产只在进入游戏/换装后按需拉取。

### 2.3 结论等级

文中使用三种标记：

- **观察**：直接从 bundle / HTML / CSS / 资产清单读到的事实。
- **推断**：由代码结构合理推出，但没有运行时验证。
- **未知**：需要线上采集或实际运行才能确认。

---

## 3. 原站逆向结论

### 3.1 技术栈与入口

#### 观察（3.1）

- 入口 `index.html` 的 `<body>` 为空，唯一入口是 `assets/webgl-C4v7tvuW.js`（module），并预加载 `runtime-C2kxzoFi.js` 与 `style-BgpnrCnL.css`。
- 应用使用 **Svelte** 编译产物：`styles/bundle.css` 中只有 `#loader.svelte-7zu2uc` 的样式，`App3D` 中包含编译后的 Svelte `Loader` 组件与 `from_html` 模板。
- 构建工具为 Vite（modulepreload、content-hash 文件名、worker 以 URL 形式引用）。
- 依赖栈：Three.js、Postprocessing（`effectComposerExtended`）、three-mesh-bvh、protobufjs、tweakpane（`tp-dfwv` 调试面板）、GSAP 风格 tween 工具（内部实现）。

#### 推断（3.1）

- 原站是 Vite + Svelte（非 SvelteKit），运行时完全客户端渲染，没有 SSR/路由。
- 调试面板表明开发期存在场景检查工具，生产环境可能通过 flag 关闭。

### 3.2 场景与渲染架构

#### 观察（`App3D#L12646`，`#L9047`，`#L11253`，`#L12572`）

```text
mainController
├── WebGLRenderer（全局唯一）
├── uiScene (2D)  ──► uiPass (RenderPass, clear=false) ──┐
├── sceneComposers.intro   (effectComposerExtended)      │
├── sceneComposers.present (effectComposerExtended)      │
└── 全局合并：全屏三角形 + baseShader
        uniforms: tScene / uWipe1 / uWipe2 / uFlash / uOverlay
```

- 两套主场景类：`introScene` 与 `presentScene`，都继承自 `scene` 基类，各自持有 composer、相机、`beforeRenderCbs`、`uploaded` Promise。
- 场景切换由 `switchToPresent()` 完成：播放 intro 的 out 动画 → 全屏 flash/wipe → dispose intro composer → 初始化 present → 反向 wipe → 播放 in 动画。
- UI 是独立的 `uiScene`，用独立的 RenderPass 叠加在 3D 之上，而不是 DOM。
- intro 场景组成：planet、sky、birds（15 只 / 5 组，沿曲线飞）、cables、waterfall、atmosphere、title（MSDF 文本）、particles、galaxies、button（`ENTER` / `BEGIN`）。
- 相机：intro 是带 autoRotate 的轨道相机；进入游戏后切换为角色跟随相机。
- 后处理：多 RenderTarget（颜色 + info/depth/normal）、`waterPass`、`outlines`（描边 + LUT 调色）、`adaptiveDPR`（动态分辨率）、CSM 阴影。

#### 推断（3.2）

- `baseShader` 的全屏三角形是全局合成器：每个场景先渲染到自己的 readBuffer，再由全局 shader 做转场/叠加，最后 UI pass 盖在最上层。
- `uWipe1/uWipe2/uFlash/uOverlay` 是四个转场/遮罩通道，分别用于场景切换、提示层、闪白。

### 3.3 角色、物理与控制

#### 观察（`App3D#L8571`，`#L8348`）

- `characters$1` 继承 `characterBatchedSkinnedMesh`：
  - BatchedMesh / MultiDraw + 骨骼纹理 + 每实例动画权重。
  - 本地角色 + 远端角色统一在同一个 batched mesh 中渲染。
  - `LOCAL_ID = "local"`，远端用连接分配的短 ID。
  - 位置/旋转/动画权重都做插值（`positionCharLerp`、`rotationCharLerp`、`animationCharLerp`）。
  - `UPDATE_DISTANCE` 控制远程角色的动画更新频率（距离 LOD）。
  - 头像资源：`avatar/avatar-bones`、`avatar/avatar-idle`、`-walk`、`-run`、`-air`、`-afk`，可换装。
- 物理：`collisionPhysics` + three-mesh-bvh（`MeshBVH`、`shapecast`、`acceleratedRaycast`）+ 胶囊体；向下射线贴地，`closestPointToPoint` 兜底。
- 控制（`charactersControls`）：
  - **automatic**：鼠标左键/触摸拖拽 → 屏幕平面上的移动向量；角色朝移动方向转身。
  - **manual**：拖拽 → 环绕相机；WASD/摇杆移动。
  - 键盘：WASD / 方向键、Space 跳、Shift 冲刺。
  - 手柄：左摇杆移动、右摇杆相机、A 键跳。
  - 触屏：摇杆 + 点击跳；`controlsCirlces` 绘制摇杆与跳跃圈。
  - 失焦/切后台自动清空输入。

#### 推断（3.3）

- 原站没有使用 pointer lock。"自动移动 + 跟随相机"是为触屏与鼠标统一设计的控制模型。
- 跳跃是物理驱动的（`_jumpRequested` + 重力），不是动画位移。

### 3.4 网络与持久化

#### 观察（3.4）

- `MicroRealmConnection`：通用 WebSocket 房间中继。
  - 控制消息为 JSON：`{ping}` / `{r:[roomPrefix, room]}` / `{leave}`。
  - 数据消息为二进制：`localID + protobuf(RealmData)`，使用 protobufjs 动态生成 schema。
  - 默认 35Hz 上行、20s 心跳；断线后按服务器列表轮换重连。
  - 生产服务器指向一个 Cloud Run 的 `wss://` 地址；本地开发默认 `ws://localhost:3005`。
- 持久化：`localStorage.questProgress`、`localStorage.modelFiles`。
- 任务进度、模型文件、动画文件都随角色数据同步。

#### 未知（3.4）

- 服务端实现、房间分配策略、鉴权方式。镜像中只有客户端代码。

#### 建议

- 复刻时不要依赖原站的生产服务器；多人应为可选阶段（P7），并自带本地/自托管服务。

### 3.5 UI 与音频

#### 观察（3.5）

- UI 类：`titlebox`、`textbox`、`dialogBox`、`questBox`、`checkList`、`emojiList`、`endScreen`、`sideButtons`、`zoneTitles`、`traitarrows`、`arrowbox`、`bubble`、`topIcon`、`tags`。
- UI 资产是 `.icon` 位图与 MSDF `.font`（heading / planet / REM-Medium / UglyDave）。
- 音频：`audioController` + `PositionalAudio`；ambience 分区（base/beach/city/factory/forest/temple/waterfalls）、音乐、脚步（含水面）、对话人声、UI 音效、表情音效。
- 交互：`meshInteraction` / `planeInteraction` 负责 3D 拾取、hover、点击；`requestInteraction` 按距离选择最近的可交互对象。

### 3.6 资产管线

#### 观察（3.6）

- 8 个 Worker：`dracoworker`、`geometryworker`、`collisionworker`、`charactergeoworker`、`glyphworker`、`msdfworker`、`bitmapworker`、`exrworker`。
- 自定义加载器：`CustomDRACOLoader`、`MSDFLoader`、`BitmapLoader`、`ExrLoader`、`CustomVideoTexture`、`KTX2Loader`。
- 几何体统一为 `.drc`；纹理统一为 `.ktx2`（Basis 转码）；字体为 `.font`（MSDF）；UI 图标为 `.icon`。
- 角色几何体按 bones / model / animation 三类文件拆分，动画文件带帧数与 fps 元数据。
- 地形按 chunk 拆分：`full_0..9.drc`、`tree-leaves_0..4.drc`。

#### 推断（3.6）

- `collisionworker` 在后台用 three-mesh-bvh 构建碰撞树，主线程只做查询。
- `charactergeoworker` 负责蒙皮几何的批量合并/预处理，配合 BatchedMesh 使用。

### 3.7 游戏内容

#### 观察（3.7）

- 任务线：`quest-employee`、`quest-caveman`、`quest-scientists`、`quest-temple`、`quest-musician`。
- NPC 类型（manifest 中 19 类）：alien、boss、caveman、chef、diver、factory-worker-a/b/c、female-scientist、fox、male-scientist、mountainman、musician、office-worker、oldwoman、owl、scout、threekid、young-lady。
- 投递物：clothes、letterwet、note、offering、postcard、samplebox。
- 其他：表情（emojis）、换装（customize）、清单（checkList）、结束画面（endScreen）。

---

## 4. 当前实现盘点

| 文件 | 职责 | 状态 |
| --- | --- | --- |
| [`src/routes/+page.svelte`](../src/routes/+page.svelte) | 模式切换、标题/说明、i18n、署名 | 工作 |
| [`src/lib/messenger/MessengerScene.svelte`](../src/lib/messenger/MessengerScene.svelte) | 创建 renderer / scene / camera / controls / 每帧循环 | 工作，但生命周期有缺陷 |
| [`src/lib/messenger/createIntroScene.ts`](../src/lib/messenger/createIntroScene.ts) | intro 星球、水、树、云 | 工作 |
| [`src/lib/messenger/createGameplayScene.ts`](../src/lib/messenger/createGameplayScene.ts) | 地形 chunk、树叶、水、瀑布/电缆/烟雾 props | 工作 |
| [`src/lib/messenger/createNpcGallery.ts`](../src/lib/messenger/createNpcGallery.ts) | 8 个 NPC 展台 | 工作，串行加载 |
| [`src/lib/messenger/createWalkScene.ts`](../src/lib/messenger/createWalkScene.ts) | 复用 intro + 角色 + 碰撞 + 输入 | 工作 |
| [`src/lib/messenger/walkController.ts`](../src/lib/messenger/walkController.ts) | 第三人称移动、贴地、相机吊臂 | 工作 |
| [`src/lib/messenger/pointerLook.ts`](../src/lib/messenger/pointerLook.ts) | 指针锁 + WASD | 工作 |
| [`src/lib/messenger/planetCollision.ts`](../src/lib/messenger/planetCollision.ts) | θ/φ 分桶径向碰撞索引 | 工作，能力有限 |
| [`src/lib/messenger/skinGeometry.ts`](../src/lib/messenger/skinGeometry.ts) | 解析 Draco `info` 元数据，保留骨骼/蒙皮属性 | 核心成果 |
| [`src/lib/messenger/skinMesh.ts`](../src/lib/messenger/skinMesh.ts) | 骨骼重建与动画 clip | 工作 |
| [`src/lib/messenger/materials.ts`](../src/lib/messenger/materials.ts) | atlas / water / clouds 材质 | 工作 |
| [`src/lib/messenger/postProcessing.ts`](../src/lib/messenger/postProcessing.ts) | gameplay 的 LUT + depth composer | 部分 |
| [`src/lib/messenger/loadGeometry.ts`](../src/lib/messenger/loadGeometry.ts) | 主线程 Draco 加载 | 工作 |
| [`src/lib/messenger/loadTextures.ts`](../src/lib/messenger/loadTextures.ts) | KTX2 加载 | 工作 |
| [`src/lib/messenger/gameplayTerrain.ts`](../src/lib/messenger/gameplayTerrain.ts) | 10 个地形 chunk + 5 个树叶 chunk | 工作，一次性加载 |
| [`src/lib/i18n/`](../src/lib/i18n/) | 中英文案 | 新增 |

**已有测试**

- `planetCollision.spec.ts`、`walkController.spec.ts`、`walkController.integration.spec.ts`、`skinGeometry.spec.ts`。

---

## 5. 差异矩阵

| 能力 | 原站 | 当前 | 差距 | 处理阶段 |
| --- | --- | --- | --- | --- |
| 场景生命周期 | intro/present Scene 类，单 renderer，转场 | `{#key}` 整树重挂载，重建 renderer | **高** | P1 |
| 后处理 | info target + 描边 + water pass + LUT + adaptive DPR | 仅 gameplay 单 pass | 高 | P4 |
| 角色渲染 | BatchedMesh + 骨骼纹理 + LOD | 单个 SkinnedMesh | 高 | P5 |
| 碰撞 | BVH + 胶囊 + 跳跃/台阶 | 径向光线 + 坡度限制 | 高 | P3 |
| 输入/相机 | 双模式 + 手柄 + 触屏 + 跳跃/冲刺 | 指针锁 + WASD，桌面 only | 中高 | P2 |
| 资产加载 | 8 Worker，主线程不阻塞 | 全主线程 | 高 | P3/P4 |
| NPC 覆盖 | 19 类，含 talk/idleTalk/walk | 8 类，仅 idle，串行 | 中 | P5 |
| 动画集 | idle/walk/run/air/afk + talk | idle/walk | 中 | P5 |
| UI | 引擎内 2D 场景 | DOM 覆盖层 | 高 | P6 |
| 游戏系统 | 任务/对话/投递/换装/表情 | 无 | 高 | P6 |
| 音频 | 完整音频系统 | 无 | 中 | P6 |
| 多人 | WebSocket + protobuf | 无 | 高 | P7（可选） |
| 资产镜像 | — | `static/messenger` 缺失 | **阻塞** | P0 |

---

## 6. 具体问题清单

### P0 — 阻塞项

1. **`static/messenger` 缺失**
   `git status` 显示 `D static/messenger`，`static/` 下只剩 `draco/` 与 `robots.txt`。所有 `/messenger/...` 请求都会 404，四个场景都无法加载。
   处理：在仓库根目录恢复 Windows junction：

   ```bat
   cmd /c mklink /J "static\messenger" "reference\messenger.abeto.co\assets"
   ```

   该目录在 git 中是 symlink；Windows 上用 junction 替代后 git 会显示为类型变化，属预期现象，不要提交这个链接本身。

### P1 — 架构级

1. **切模式重建一切**
   [`MessengerScene.svelte:256`](../src/lib/messenger/MessengerScene.svelte#L256) 的 teardown 只调用 `renderer.dispose()`，没有释放 texture / material / geometry。`{#key sceneMode}` 每次切换都会重新 fetch + 解码 + 上传 GPU。
   处理：单 renderer + `SceneHost` 资源登记 + 显式 dispose。

2. **renderer 上下文累积**
   每次挂载新建 `WebGLRenderer`，浏览器 WebGL context 数量有限，反复切换可能触发 context lost。
   处理：同 P1。

### P2 — 行为级

1. **控制模型不一致**
   [`pointerLook.ts`](../src/lib/messenger/pointerLook.ts) 使用 pointer lock；原站是拖拽移动/拖拽环视，且支持跳跃、冲刺、手柄、触屏。
   处理：新建 `CharacterInput`，保留 pointer lock 作为调试输入。

2. **walk 预设中的死配置**
   [`MessengerScene.svelte:31-34`](../src/lib/messenger/MessengerScene.svelte#L31-L34) 中 walk 的 `camera/minDist/maxDist` 不生效。
   处理：迁移到 `SceneHost` 时删除或改成真实参数。

### P3 — 性能级

1. **NPC 展台串行加载**
   [`createNpcGallery.ts:82`](../src/lib/messenger/createNpcGallery.ts#L82) 的 `for…await` 让 8×3 个文件排队解码。
   处理：改为 `Promise.all`，并考虑与 P5 的批量加载合并。

2. **主线程重活**
   - [`loadGeometry.ts`](../src/lib/messenger/loadGeometry.ts) 主线程 Draco。
   - [`gameplayTerrain.ts:6`](../src/lib/messenger/gameplayTerrain.ts#L6) 一次性解 10 个地形 chunk + 5 个树叶 chunk，逐个 `computeVertexNormals()`。
   - [`planetCollision.ts:92`](../src/lib/messenger/planetCollision.ts#L92) 进入 walk 时同步构建 59k 三角形索引。
   处理：P3 引入最小 Worker（Draco 解码 + BVH 构建）。

3. **径向碰撞的能力边界**
   [`planetCollision.ts`](../src/lib/messenger/planetCollision.ts) 注释已说明：屋顶、拱门、悬挑会被当成地面。加跳跃/台阶后问题更明显。
   处理：P3 换 BVH + 胶囊。

---

## 7. 方案选择

| 方案 | 内容 | 工作量 | 风险 | 适合目标 |
| --- | --- | --- | --- | --- |
| A. 演示增强 | 保留 4 模式；修资产、并行加载、加跳跃/冲刺、加描边 | 1–2 周 | 低 | 更好看的技术 demo |
| **B. 架构对齐（推荐）** | 单 renderer + Scene 基类 + 输入抽象 + BVH 物理 + Worker 解码 | 3–5 周 | 中 | 可持续演进的可玩复刻 |
| C. 完整复刻 | B + 任务/对话/UI/音频/多人 | 数月 | 高（含服务端） | 接近原站的产品 |

### 推荐：方案 B

理由：

- 真正昂贵且已经跑通的是**渲染/资产层**：shader 移植、Draco `info` 解析、蒙皮重建、KTX2、地形/水/树。整体重写等于把最难的部分再做一遍。
- 当前阻碍对齐原站的是**运行时骨架**（场景生命周期、输入、物理、UI），代码量小、耦合低，适合重写。
- 分阶段可以随时停在 A 或继续到 C，不会产生废弃代码。

---

## 8. 分阶段实施计划

> 人日为单人 + AI 辅助的粗略估计，不含美术/内容制作。

### P0 资产与环境基线（0.5 人日）

**目标**：让现有四个模式可靠运行。

任务：

- [ ] 恢复 `static/messenger` junction → `reference/messenger.abeto.co/assets`。
- [ ] 新增 dev 自检：启动时 HEAD 检查关键资产（`images/atlas.png`、`geometries/planets/present/intro/planet.drc`、`libs/basis/basis_transcoder.wasm`），缺失时在控制台列出。
- [ ] 验证 KTX2 转码路径（`/messenger/libs/basis/`）在 junction 生效后可访问到 `basis_transcoder.js` / `.wasm`。

**验收**：四个模式全部加载成功，Network 面板无 404。

### P1 运行时外壳（2–3 人日）

**目标**：单 renderer、可复用的场景生命周期、显式资源释放。

新增：

- `src/lib/app/AppController.ts`：全局唯一 `WebGLRenderer`、composer、RAF 循环、resize、DPR。
- `src/lib/app/SceneHost.ts`：场景基类，生命周期 `upload → playIn → update → playOut → dispose`；资源登记表。
- `src/lib/app/transition.ts`：全屏三角形 + wipe/flash uniform。

改造：

- `createIntroScene` / `createGameplayScene` / `createWalkScene` 提升为 `IntroScene` / `PresentScene` 类。
- `MessengerScene.svelte` 只负责挂载 `AppController`，不再直接建 renderer。
- 切场景使用转场，不销毁 renderer。

**验收**：

- intro ↔ present 往返 20 次，`WebGLRenderer` 只创建一次。
- 切换前后 `renderer.info.memory` 不增长。
- 现有 4 个单测保持绿色。

### P2 输入与相机（2–3 人日）

**目标**：行为对齐原站控制模型。

新增：

- `src/lib/input/CharacterInput.ts`
  - automatic：左键/触摸拖拽 → 屏幕平面位移。
  - manual：拖拽 → 环绕相机；WASD/摇杆移动。
  - Space 跳、Shift 冲刺、手柄、触屏摇杆、失焦清键。
- `src/lib/camera/FollowCamera.ts`：球坐标目标 + 阻尼 + 自动旋转（intro 用）。

改造：

- `walkController` 的相机段替换为 `FollowCamera`。
- 保留 `pointerLook.ts` 作为调试输入。

**验收**：

- 键鼠、手柄、触屏三种输入都能完成"移动到指定点"。
- 松开按键/失焦后不粘键。
- 相机遇障碍物有合理的距离收缩或抬升。

### P3 物理与 Worker（3–5 人日）

**目标**：支持跳跃、台阶、非径向几何；把重活移出主线程。

新增：

- `src/lib/physics/CollisionWorld.ts`：three-mesh-bvh 构建、胶囊 sweep、向下射线贴地、坡度/台阶、重力与跳跃。
- `src/lib/workers/decode.worker.ts`：Draco 解码 + BVH 构建，`transferable` 回传。

改造：

- `planetCollision.ts` 保留为 intro 星球的轻量方案；游戏场景切到 `CollisionWorld`。
- `walkController` 的移动/贴地段改为调用 `CollisionWorld`。

**验收**：

- 角色能上台阶、跳起落到斜面、不穿墙。
- 加载与索引构建期间主线程无 >50ms 长任务（Performance 面板）。

### P4 渲染对齐（3–5 人日）

**目标**：还原原站画面风格。

任务（按顺序）：

- [ ] `outlines`：info target（深度/法线）+ 描边。
- [ ] `waterPass`：水面折射/反射。
- [ ] LUT 调色统一到所有场景。
- [ ] `adaptiveDPR`：动态分辨率。
- [ ] 统一材质 uniform / UBO，避免每个材质一份 light/time。

**验收**：intro 与 present 各截一张图，与原站同视角并排比对，差异可解释。

### P5 角色与 NPC（3–4 人日）

**目标**：角色动画集与 NPC 覆盖接近原站。

任务：

- [ ] 动画扩到 idle / walk / run / air / afk。
- [ ] NPC 增加 talk / idleTalk。
- [ ] NPC 加载并行化。
- [ ] 覆盖 manifest 中的 19 类 NPC。
- [ ] 评估 BatchedMesh + 骨骼纹理（与 P4 的 UBO 改造一起做）。

**验收**：

- NPC 展台加载时间下降 ≥50%。
- 所有 NPC 有 idle，主要角色有 talk。
- 角色在 run/air 状态下动画切换无明显跳变。

### P6 游戏系统（1–2 周）

**目标**：完成一条可玩的闭环。

任务：

- [ ] 交互层：射线拾取 + hover/click + 距离排序（`meshInteraction` 等价物）。
- [ ] 对话盒 → 任务系统（先做 1 条任务线）。
- [ ] 2D UI：先 DOM 覆盖层快速实现，再评估是否移植 `uiScene`。
- [ ] 音频：ambience 分区 + 脚步 + UI 音效。
- [ ] 持久化：`questProgress` 结构对齐原站。

**验收**：完成"接任务 → 找 NPC → 对话 → 完成"的闭环，刷新后进度保留。

### P7 多人（可选，1–2 周 + 服务端）

**目标**：两个浏览器互相可见。

任务：

- [ ] 自建 WebSocket 房间服务（不要依赖原站 Cloud Run 实例）。
- [ ] 位置/朝向/动画同步（参考原站 35Hz + 插值）。
- [ ] 远端角色渲染与 LOD。

**验收**：两个浏览器能看到对方移动、转向、播放动画。

---

## 9. 里程碑

| 里程碑 | 包含阶段 | 结果 |
| --- | --- | --- |
| M1 可用 | P0–P1 | 四模式稳定运行，切场景不重启渲染器 |
| M2 可走 | P2–P3 | 原站控制手感 + 跳跃/台阶 + 无主线程卡顿 |
| M3 像原站 | P4–P5 | 画面风格与角色/NPC 覆盖接近 |
| M4 可玩 | P6 | 一条任务闭环 |
| M5 可联机 | P7 | 双人同房间 |

预估：M1 ≈ 3 天，M2 ≈ 1.5 周，M3 ≈ 2.5 周，M4 ≈ 4 周，M5 另计。

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 镜像资产不完整（无 `avatar/`、无 `.exr`） | P5/P7 无法完整复刻 | 先做现有资产能覆盖的部分；需要时用浏览器重新抓取 |
| 线上站已更新，镜像落后 | 结论过时 | 换权限模式后用 REA 重新采集对比 |
| BVH 构建耗时 | 进游戏卡顿 | 放 Worker；按 chunk 增量构建 |
| BatchedMesh 改造范围大 | P5 超期 | 先单 SkinnedMesh + 并行加载，批量渲染作为可选优化 |
| UI 迁移成本高 | P6 超期 | 先用 DOM 覆盖层，视觉对齐后再评估 uiScene |
| 多人服务端不可控 | P7 无法完成 | 保持可选；自建最小房间服务 |

---

## 11. Non-goals（本计划不做）

- 不重新实现原站的 8 Worker 全套管线；只做 1 个最小解码 Worker。
- 不移植 `GPUSim` / 蝴蝶 / 草地的 GPU 仿真，直到 P4 之后再评估。
- 不依赖原站的生产多人服务器。
- 不复制原站的任务文案、对话文本与美术资产用于再分发。
- 不在 P1–P3 阶段引入 UI 框架或状态管理库。

---

## 12. 待确认

1. 目标档位是 A / B / C 哪一档？P3–P6 是否全要？
2. 是否需要移动端触屏支持（影响 P2 的范围）？
3. 多人（P7）是否在路线内？
4. 是否要我按本计划直接开始 P0–P1？

---

## 附录 A：证据索引

| 主题 | 位置 |
| --- | --- |
| 入口 HTML | `reference/messenger.abeto.co/index.html` |
| 主控制器 / 场景编排 | `App3D-BLRWK1h9.js#L12646` |
| intro 场景组成 | `App3D-BLRWK1h9.js#L9047` |
| 角色 / 网络 / 物理 | `App3D-BLRWK1h9.js#L8571` |
| 控制与相机 | `App3D-BLRWK1h9.js#L8348` |
| 任务控制器 | `App3D-BLRWK1h9.js#L8668` |
| present 场景 / NPC 表 | `App3D-BLRWK1h9.js#L11120` |
| 3D/2D 场景基类 | `App3D-BLRWK1h9.js#L11253`、`#L12572` |
| 提取的 GLSL | `reference/messenger.abeto.co/shaders/`（193 个文件） |
| 资产清单 | `reference/messenger.abeto.co/manifest.txt` |
| 网络请求清单 | `reference/messenger.abeto.co/network-urls*.txt` |

## 附录 B：建议目录结构（P1 之后）

```text
src/lib/
├── app/
│   ├── AppController.ts     # renderer / composer / loop
│   ├── SceneHost.ts         # 场景生命周期与资源登记
│   └── transition.ts        # 全屏转场
├── scenes/
│   ├── IntroScene.ts
│   └── PresentScene.ts
├── input/
│   └── CharacterInput.ts
├── camera/
│   └── FollowCamera.ts
├── physics/
│   ├── CollisionWorld.ts
│   └── planetCollision.ts   # 保留的轻量径向方案
├── workers/
│   └── decode.worker.ts
├── game/
│   ├── interaction/
│   ├── quests/
│   └── audio/
└── messenger/               # 现有资产/材质/几何代码
    ├── loadGeometry.ts
    ├── skinGeometry.ts
    ├── materials.ts
    └── ...
```
