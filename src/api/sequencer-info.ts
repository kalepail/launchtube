import { RequestLike, error, json } from "itty-router";
import { SEQUENCER_ID_NAME } from "../common";
import { SequencerDurableObject } from "../sequencer";

export async function apiSequencerInfo(request: RequestLike, env: Env, _ctx: ExecutionContext) {
    // TODO DRY out Authorization checks
    const token = request.headers.get('Authorization').split(' ')[1]

    if (!await env.SUDOS.get(token))
        return error(401, 'Unauthorized')

    const sequencerId = env.SEQUENCER_DURABLE_OBJECT.idFromName(SEQUENCER_ID_NAME);
    const sequencerStub = env.SEQUENCER_DURABLE_OBJECT.get(sequencerId) as DurableObjectStub<SequencerDurableObject>;

    return json(await sequencerStub.getData())
}