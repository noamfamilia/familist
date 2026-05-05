export default function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-900 p-6">
      <div className="max-w-md w-full rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-teal mb-2">You are offline</h1>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-5">
          MyFamiList can still show cached lists and pending edits. Reconnect to sync updates.
        </p>
        <a
          href="/"
          className="inline-flex items-center rounded-lg bg-teal text-white px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          Back to Home
        </a>
      </div>
    </main>
  )
}
