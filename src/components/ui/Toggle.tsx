'use client'

interface ToggleProps {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  className?: string
  variant?: 'default' | 'menu'
}

export function Toggle({ options, value, onChange, className = '', variant = 'default' }: ToggleProps) {
  const activeStyles = variant === 'menu' 
    ? 'bg-teal text-white' 
    : 'bg-teal text-white border-teal'
  
  const inactiveStyles = variant === 'menu'
    ? 'bg-gray-200 text-primary hover:opacity-80'
    : 'bg-gray-50 text-primary border-gray-200 hover:bg-cyan-light'

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
