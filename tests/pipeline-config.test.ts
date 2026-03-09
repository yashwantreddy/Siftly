import assert from 'node:assert/strict'
import test from 'node:test'

import { PIPELINE_WORKERS } from '../lib/pipeline-config'

test('pipeline worker default is capped at four', () => {
  assert.equal(PIPELINE_WORKERS, 4)
})
