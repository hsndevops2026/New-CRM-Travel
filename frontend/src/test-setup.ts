import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { setLanguage } from './lib/i18n'

// Existing component assertions exercise the English interface.
beforeEach(() => setLanguage('en'))

// vitest runs with globals:false, so @testing-library/react cannot register its
// automatic afterEach(cleanup) hook. Without this, every render in a file stays
// mounted and later queries match elements left over from earlier tests.
afterEach(cleanup)
