import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as ComposerCatalogClient from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('ui-composer-catalog real Loader composition', () => {
  it('activates the shipped client package row as an ordinary Loader plugin', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-client-composer-catalog-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, "- name: '@deepseek-ai/dsh-client-ui-composer-catalog'\n")
    context = new Context()
    context.baseUrl = `${pathToFileURL(root).href}/`
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier !== '@deepseek-ai/dsh-client-ui-composer-catalog') {
          throw new Error(`unexpected Loader import: ${specifier}`)
        }
        return ComposerCatalogClient
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()
    const entry = [...context.loader.entries()].find(candidate =>
      candidate.options.name === '@deepseek-ai/dsh-client-ui-composer-catalog')
    expect(entry?.fiber).toBeDefined()
    expect([...context.loader.entries()].filter(candidate => candidate.fiber === undefined && !candidate.disabled)).toEqual([])
  })
})
