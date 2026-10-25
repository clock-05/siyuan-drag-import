/**
 * M2 探针：文件夹场景里唯一没被打过的一个假设 ——
 * 父目录还不存在时，getIDsByHPath 是返回空数组还是报错。
 * 报错的话 planner 会把整批文件判成「查重失败」，所以必须先确认。
 *
 * 用法：思源运行时 node research/m2/probe-missing-parent.mjs
 * 只用临时笔记本，finally 删除。
 */

const BASE = "http://127.0.0.1:6806";
const NB_NAME = `M2-probe-${Date.now().toString().slice(-5)}`;

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

let nbId = "";
try {
  const created = await api("/api/notebook/createNotebook", { name: NB_NAME });
  nbId = created?.data?.notebook?.id ?? "";
  console.log(`临时笔记本: ${nbId}`);

  const fresh = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/还没建的父/子" });
  console.log("\n① 父目录不存在时：", JSON.stringify(fresh));

  const one = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/还没建的父" });
  console.log("② 只查父目录本身：", JSON.stringify(one));

  await api("/api/filetree/createDocWithMd", { notebook: nbId, path: "/还没建的父/子", markdown: "x" });
  const after = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/还没建的父/子" });
  console.log("③ 建完之后再查：", JSON.stringify(after));

  const spaced = await api("/api/filetree/getIDsByHPath", { notebook: nbId, path: "/还没建的父/子 (2)" });
  console.log("④ 带后缀的路径：", JSON.stringify(spaced));

  console.log(`\n结论：code=${fresh.code}，data 是数组吗=${Array.isArray(fresh.data)}`);
} finally {
  if (nbId) {
    const removed = await api("/api/notebook/removeNotebook", { notebook: nbId });
    console.log(`🧹 删除临时笔记本: ${removed?.code === 0 ? "ok" : JSON.stringify(removed)}`);
  }
}
