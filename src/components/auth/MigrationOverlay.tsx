'use client'

export function MigrationOverlay() {
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white/90 px-6 dark:bg-neutral-900/90"
      role="alertdialog"
      aria-busy="true"
      aria-live="polite"
      aria-label="Migrating your lists to your account"
    >
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-teal border-t-transparent" />
      <p className="text-center text-sm font-medium text-gray-700 dark:text-gray-200">
        Migrating your lists to your account…
      </p>
    </div>
  )
}
