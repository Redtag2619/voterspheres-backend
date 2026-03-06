import express from "express";

const router = express.Router();

/*
Simulated donor dataset
*/

let donors = [
{
name:"Michael Thompson",
industry:"Finance",
totalDonations:1200000,
supportedCandidates:["Jane Smith","Alex Johnson"]
},
{
name:"Linda Chen",
industry:"Technology",
totalDonations:900000,
supportedCandidates:["Tom Rivera"]
},
{
name:"Robert Garcia",
industry:"Real Estate",
totalDonations:650000,
supportedCandidates:["Jane Smith"]
}
];


/*
GET all donors
*/

router.get("/",(req,res)=>{

res.json({
success:true,
totalDonors: donors.length,
donors
});

});


/*
Find donors supporting a candidate
*/

router.get("/candidate/:name",(req,res)=>{

const candidate = req.params.name;

const supporters = donors.filter(d =>
d.supportedCandidates.includes(candidate)
);

res.json({
success:true,
candidate,
supporters
});

});

export default router;
