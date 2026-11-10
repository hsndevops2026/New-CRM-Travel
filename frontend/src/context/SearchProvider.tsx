import { useMemo, useState, type ReactNode } from 'react'
import { SearchContext } from './search'

export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('')
  const [placeholder, setPlaceholder] = useState('Search…')
  const value = useMemo(
    () => ({ query, setQuery, placeholder, setPlaceholder }),
    [query, placeholder],
  )
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}
