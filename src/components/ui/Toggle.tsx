'use client'

interface ToggleProps {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function Toggle({ options, value, onChange, className = '' }: ToggleProps) {
  return (
    <div className={`flex gap-1 ${className}`}>
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`px-4 py-2 text-sm transition-all duration-200 ${
            index === 0 ? 'rounded-l-md' : ''
          } ${
            index === options.length - 1 ? 'rounded-r-md' : ''
          } ${
            value === option.value
              ? 'bg-teal text-white border-teal'
              : 'bg-gray-50 text-primary border-gray-200 hover:bg-cyan-light'
          } border`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
