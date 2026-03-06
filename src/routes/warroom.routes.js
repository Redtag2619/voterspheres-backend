import express from "express";

const router = express.Router();

/*
Simulated campaign intelligence data
*/

let campaigns = [
{
candidate: "Jane Smith",
race: "Governor",
state: "PA",
polling: 47,
fundraising: 4200000,
oppositionSpending: 5000000,
districtLean: "D+2",
voterTurnoutLastElection: 61
},
{
candidate: "Tom Rivera",
race: "Senate",
state: "AZ",
polling: 49,
fundraising: 6500000,
oppositionSpending: 3000000,
districtLean: "R+1",
voterTurnoutLastElection: 64
}
];


/*
AI Strategy Engine
*/

function generateStrategy(c){

let winProbability = 50;
let recommendations = [];

if(c.polling > 50) winProbability += 15;
if(c.polling < 48) winProbability -= 10;

if(c.fundraising > c.oppositionSpending)
winProbability += 10;
else
recommendations.push("Increase fundraising events immediately");

if(c.oppositionSpending > c.fundraising)
recommendations.push("Deploy rapid-response media strategy");

if(c.voterTurnoutLastElection < 60)
recommendations.push("Invest in field GOTV operations");

if(c.polling < 49)
recommendations.push("Increase persuasion digital advertising");

return {
winProbability,
recommendations
};

}

/*
GET War Room Dashboard
*/

router.get("/", (req,res)=>{

const intelligence = campaigns.map(c => {

const strategy = generateStrategy(c);

return {
...c,
warRoom: strategy
};

});

res.json({
success:true,
campaigns:intelligence
});

});

export default router;
