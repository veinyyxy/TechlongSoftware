export default function SubscriptionCleanupPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <div className="rounded-3xl border border-red-200 bg-red-50 p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-700">
          一次性管理员操作
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">
          清空客户订阅
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-700">
          本操作只允许在当前生产数据库正好存在 2 条订阅时执行。付款记录和应用实例保留，
          但会解除订阅关联。
        </p>
        <form
          action="/api/admin/subscriptions/cleanup"
          method="post"
          className="mt-8"
        >
          <input
            type="hidden"
            name="confirmation"
            value="DELETE_ALL_SUBSCRIPTIONS_ONCE"
          />
          <input type="hidden" name="expectedCount" value="2" />
          <button
            type="submit"
            className="rounded-full bg-red-700 px-6 py-3 text-sm font-semibold text-white"
          >
            确认删除 2 条订阅
          </button>
        </form>
      </div>
    </main>
  );
}
