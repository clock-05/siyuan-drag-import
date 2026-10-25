/**
 * 串行队列：一次只跑一个任务，后来的排队。
 *
 * 为什么需要：两个导入批次并行会各自查重、互相看不见对方正在建的文档，
 * 同名判断直接失效（可能撞出重复文档），结果卡片和撤销入口也会互相顶掉。
 *
 * 0.7.3 只在「拖入」这一条路上排了队，**重试失败项是直接跑的** ——
 * 重试期间再拖一批就又并行；0.8.2 起所有会写库的流程都走这里。
 */
export class SerialQueue {
  private jobs: Array<{ run: () => Promise<void>; done: () => void }> = [];
  private running = false;
  private stopped = false;

  /** 有任务在跑，或者有任务在排队（用来决定要不要提示「排在它后面」） */
  get busy(): boolean {
    return this.running || this.jobs.length > 0;
  }

  /** 入队；返回的 Promise 在任务跑完时 resolve、抛错时 reject */
  push(job: () => Promise<void>): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.jobs.push({
        run: async () => {
          try {
            await job();
            resolve();
          } catch (error) {
            reject(error);
          }
        },
        done: resolve,
      });
      void this.drain();
    });
  }

  /** 卸载 / 重载：丢掉还没开始的（并让它们的 Promise 结算），在跑的那个自己收尾 */
  stop(): void {
    this.stopped = true;
    for (const job of this.jobs.splice(0)) {
      job.done();
    }
  }

  private async drain(): Promise<void> {
    if (this.running || this.stopped) {
      return;
    }
    this.running = true;
    try {
      while (this.jobs.length > 0 && !this.stopped) {
        const job = this.jobs.shift()!;
        // 任务内部的异常已经转成 Promise 的 reject，这里不会被打断
        await job.run();
      }
    } finally {
      this.running = false;
      // 收尾期间被 stop 的：剩下的直接结算，别让调用方永远 await
      if (this.stopped) {
        for (const job of this.jobs.splice(0)) {
          job.done();
        }
      }
    }
  }
}
