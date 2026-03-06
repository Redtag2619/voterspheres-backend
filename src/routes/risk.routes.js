import express from "express";

const router = express.Router();

/*
Simulated campaign risk scores
*/

let campaigns = [
{
candidate:"Jane Smith",
race:"Governor",
state:"PA",
polling:47,
fundraising:4200000,
oppositionSpending:5000000
},
{
candidate:"Tom Rivera",
race:"Senate",
state:"AZ",
polling:49,
fundraising:6500000,
oppositionSpending:3000000
}
];


/*
Risk algorithm
*/

function calculateRisk(c){

let riskScore = 0;

if(c.polling < 48) riskScore += 40;

if(c.oppositionSpending > c.fundraising)
riskScore += 35;

if(c.fundraising < 3000000)
riskScore += 25;

return riskScore;

}

/*
GET Risk Dashboard
*/

router.get("/",(req,res)=>{

const riskAnalysis = campaigns.map(c => {

const score = calculateRisk(c);

let level = "LOW";

if(score > 60) level = "HIGH";
else if(score > 30) level = "MEDIUM";

return {
...c,
riskScore: score,
riskLevel: level
};

});

res.json({
success:true,
campaigns:riskAnalysis
});

});

export default router;
