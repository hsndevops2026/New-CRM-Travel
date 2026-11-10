import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest runs with globals:false, so @testing-library/react cannot register its
// automatic afterEach(cleanup) hook. Without this, every render in a file stays
// mounted and later queries match elements left over from earlier tests.
afterEach(cleanup)
