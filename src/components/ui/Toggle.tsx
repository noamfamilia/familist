'use client'

interface ToggleOption<T extends string> {
  value: T
  label: string
}

interface ToggleProps<T extends string> {
  options: ToggleOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  variant?: 'default' | 'menu'
}

export function Toggle<T extends string>({ options, value, onChange, className = '', variant = 'default' }: ToggleProps<T>) {
  const activeStyles = variant === 'menu' 
    ? 'bg-teal text-white' 
    : 'bg-teal text-white border-teal'
  
  const inactiveStyles = variant === 'menu'
    ? 'bg-gray-200 dark:bg-neutral-700 text-primary dark:text-gray-100 hover:opacity-80'
    : 'bg-gray-50 dark:bg-neutral-900 text-primary dark:text-gray-100 border-gray-200 dark:border-neutral-600 hover:bg-cyan-light'

  return (
    <div className={`flex ${className}`}>
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`px-2 py-1.5 text-sm transition-all duration-200 ${
            index === 0 ? 'rounded-l-lg' : ''
          } ${
            index === options.length - 1 ? 'rounded-r-lg' : ''
          } ${
            value === option.value ? activeStyles : inactiveStyles
          } ${variant === 'default' ? 'border' : ''}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
