/** Host Remote owner for Host-owned Automation rules. */

import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { AutomationInputError, AutomationPersistenceError } from './errors.ts'
import type {
  AutomationDeleteValue,
  AutomationListValue,
  AutomationRuleId as AutomationRuleIdType,
  AutomationRunId as AutomationRunIdType,
  AutomationRuleValue,
  AutomationRunValue,
  AutomationRunRecord, CreateAutomationRuleRequest, UpdateAutomationRuleRequest,
} from './types.ts'

function AutomationRuleId(id: string): AutomationRuleIdType {
  return id as AutomationRuleIdType
}

function AutomationRunId(id: string): AutomationRunIdType {
  return id as AutomationRunIdType
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    automationController: AutomationController
  }
}

function automationFailure(error: unknown): never {
  if (error instanceof AutomationInputError) {
    throw new RemoteError('automation/rejected', error.message, { automationCode: error.code })
  }
  if (error instanceof AutomationPersistenceError) {
    throw new RemoteError('automation/rejected', error.message, { automationCode: 'persistence_uncertain' })
  }
  throw new RemoteError('automation/rejected', error instanceof Error ? error.message : String(error), { automationCode: 'internal_error' })
}

/** Host service backing ctx.remote.automation. */
export class AutomationController extends TypertRemoteService {
  static inject = ['automation', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'automationController', { namespace: 'automation' })
  }

  @Remote('list')
  list(): AutomationListValue {
    return { items: this.ctx.automation.list() }
  }

  @Remote('create')
  async create(request: CreateAutomationRuleRequest): Promise<AutomationRuleValue> {
    try {
      return { rule: await this.ctx.automation.create(request) }
    } catch (error: unknown) {
      automationFailure(error)
    }
  }

  @Remote('update')
  async update(request: UpdateAutomationRuleRequest & { id: string }): Promise<AutomationRuleValue> {
    const { id, ...patch } = request
    try {
      return { rule: await this.ctx.automation.update(AutomationRuleId(id), patch) }
    } catch (error: unknown) {
      automationFailure(error)
    }
  }

  @Remote('delete')
  async delete(request: { id: string }): Promise<AutomationDeleteValue> {
    try {
      return { id: request.id, deleted: await this.ctx.automation.delete(AutomationRuleId(request.id)) }
    } catch (error: unknown) {
      automationFailure(error)
    }
  }

  @Remote('setEnabled')
  async setEnabled(request: { id: string; enabled: boolean }): Promise<AutomationRuleValue> {
    try {
      return { rule: await this.ctx.automation.setEnabled(AutomationRuleId(request.id), request.enabled) }
    } catch (error: unknown) {
      automationFailure(error)
    }
  }

  @Remote('runNow')
  async runNow(request: { id: string }): Promise<AutomationRunValue> {
    try {
      return { run: await this.ctx.automation.runNow(AutomationRuleId(request.id)) }
    } catch (error: unknown) {
      automationFailure(error)
    }
  }

  @Remote('listRuns')
  listRuns(request: { id: string; limit?: number }): { items: readonly AutomationRunRecord[] } {
    return { items: this.ctx.automation.listRuns(AutomationRuleId(request.id), request.limit ?? 20) }
  }

  @Remote('deleteRun')
  async deleteRun(request: { id: string }): Promise<AutomationDeleteValue> {
    try {
      return { id: request.id, deleted: await this.ctx.automation.deleteRun(AutomationRunId(request.id)) }
    } catch (error: unknown) {
      automationFailure(error)
    }
  }
}

export default AutomationController
