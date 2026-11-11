import { writableRoots } from '@deepseek-ai/dsh-sandbox'
console.log(JSON.stringify(writableRoots({ mode: 'workspace-write', workspaceRoot: '/private/tmp/x/workspace' }), null, 2))
console.log('cwd =', process.cwd())
