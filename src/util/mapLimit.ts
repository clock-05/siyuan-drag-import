/**
 * 有限并发跑一批异步任务，结果按输入顺序返回。
 *
 * 用于查同名：每篇一次 HTTP 往返，串行跑 500 篇要 1.5–2 秒，
 * 这段时间界面上什么都不会发生。8 路并发能把它压到一次往返还多一点。
 *
 * 注意：只给**无副作用**的任务用。写操作（建文档、改正文）走并发会改变结果。
 */
export async function mapLimit<T, R>(
  list: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(list.length);
  if (list.length === 0) {
    return results;
  }

  const width = Math.max(1, Math.min(limit, list.length));
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= list.length) {
        return;
      }
      results[index] = await run(list[index]);
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
