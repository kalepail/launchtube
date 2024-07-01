import { CreditsDurableObject } from "./credits";
import { SequencerDurableObject } from "./sequencer";
import { IttyRouter, cors, error, html, withParams, RequestLike } from 'itty-router'
import { apiLaunch } from "./api/launch";
import { apiSequencerInfo } from "./api/sequencer-info";
import { apiTokenInfo } from "./api/token-info";
import { apiTokenDelete } from "./api/token-delete";
import { apiTokensGenerate } from "./api/tokens-generate";
import { apiSql } from "./api/sql";
import { apiTokenActivate } from "./api/token-activate";

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
	// Public endpoints
	.get('/', (req: RequestLike, _env: Env, _ctx: ExecutionContext) => {
		return html(`
			<h1>Activate Launchtube Token</h1>
			<form method="POST" action="/activate">
				<p>
					<label for="consent">Agree to <a href="/terms">T&C</a>:</label>
					<input type="checkbox" id="consent" name="consent" required>
				</p>
				<p>
					<label for="token">Token:</label>
					<input type="text" id="token" name="token" value=${req.query.token} required>
				</p>
				<button type="submit">Activate</button>
			</form>
		`)
	})
	.post('/activate', apiTokenActivate)
	.get('/info', apiTokenInfo)
	.post('/', apiLaunch)
	// Private endpoints
	.get('/gen', apiTokensGenerate)
	.delete('/:sub', apiTokenDelete)
	.get('/seq', apiSequencerInfo)
	.post('/sql', apiSql)
	// ---
	.all('*', () => error(404))

const handler = {
	fetch: (req: Request, env: Env, ctx: ExecutionContext) =>
		router
			.fetch(req, env, ctx)
			.catch((err) => {
				console.error(err);
				return error(
					typeof err?.status === 'number' ? err.status : 400,
					err instanceof Error ? err?.message : err
				)
			})
			.then((r) => corsify(r, req))
}

export {
	SequencerDurableObject,
	CreditsDurableObject,
	handler as default
}