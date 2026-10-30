import {test} from 'node:test';
import assert from 'node:assert/strict';
import {meetingTime,localMeetingInput,nextMeetingStep} from '../web/meeting.js';
test('meeting time roundtrips through local form input and explains missing dates',()=>{
 const value='2030-02-15T14:30:00.000Z';assert.equal(new Date(localMeetingInput(value)).toISOString(),value);assert.equal(meetingTime(null),'Termin noch offen');assert.equal(localMeetingInput(null),'');
});
test('next step differentiates approval, scheduling and closed conversations',()=>{
 assert.match(nextMeetingStep({status:'PENDING'}),/prüft/);
 assert.match(nextMeetingStep({status:'APPROVED',can_send:true}),/Stimmt euch/);
 assert.match(nextMeetingStep({status:'APPROVED',can_send:true,meeting_at:'2030-01-01'}),/Termin steht/);
 assert.match(nextMeetingStep({status:'APPROVED',can_send:false}),/nicht mehr verfügbar/);
 assert.match(nextMeetingStep({status:'CANCELLED'}),/abgeschlossen/);
});
