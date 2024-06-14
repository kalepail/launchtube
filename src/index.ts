import { CreditsDurableObject } from "./credits";
import { SequencerDurableObject } from "./sequencer";
import { IttyRouter, cors, error, withParams } from 'itty-router'
import { apiLaunch } from "./api/launch";
import { apiSequencerInfo } from "./api/sequencer-info";
import { apiTokenInfo } from "./api/token-info";
import { apiTokenDelete } from "./api/token-delete";
import { apiTokensGenerate } from "./api/tokens-generate";
import { apiSql } from "./api/sql";

const { preflight, corsify } = cors()
const router = IttyRouter()

/* TODO
	- Likely need some rate limiting around here
		Throttle on dupe params
		Throttle on sequence creation
		Eager credit spending may be a sufficient deterrent
	- Support generic transaction fee bumping?
		Currently Launchtube only supports contract invocation operations
		I think folks will want this, otherwise they'll need to maintain both Soroban submission flows and Classic submission flows
			No XLM needed for Soroban
			XLM needed for Stellar
			Bit of an oof
		At the very least we should support all the Soroban ops incl. `Operation.ExtendFootprintTTL` and `Operation.RestoreFootprint`
*/

router
	.options('*', preflight)
	.all('*', withParams)
	.post('/', apiLaunch)
	.get('/seq', apiSequencerInfo)
	.get('/gen', apiTokensGenerate)
	.get('/', apiTokenInfo)
	.delete('/:sub', apiTokenDelete)
	.post('/sql', apiSql)
	.all('*', () => error(404))

const handler = {
	fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
		router
			.fetch(request, env, ctx)
			.catch((err) => {
				console.error(err);
				return error(
					typeof err?.status === 'number' ? err.status : 400,
					err instanceof Error ? err?.message : err
				)
			})
			.then((r) => corsify(r, request))
}

export {
	SequencerDurableObject,
	CreditsDurableObject,
	handler as default
}