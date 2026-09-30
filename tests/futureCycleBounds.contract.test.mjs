import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFederalElectionCycles, ElectionCycleValidationError } from '../utils/electionCycle.js';
test('future federal cycles generate 2028 and beyond',()=>assert.deepEqual(buildFederalElectionCycles({startYear:2028,count:4}),[2028,2030,2032,2034]));
test('upper bound never generates an unsupported cycle',()=>assert.deepEqual(buildFederalElectionCycles({startYear:2200,count:8}),[2200]));
test('invalid count fails instead of silently truncating fractions',()=>{
 for(const count of [0,-1,1.5,51,'bad']) assert.throws(()=>buildFederalElectionCycles({count}),ElectionCycleValidationError);
});
