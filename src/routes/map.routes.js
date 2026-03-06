import express from "express";

const router = express.Router();

/*
Simulated national races
*/

let races = [
{
state:"Pennsylvania",
race:"Governor",
candidate:"Jane Smith",
party:"D",
polling:47
},
{
state:"Arizona",
race:"Senate",
candidate:"Tom Rivera",
party:"R",
polling:49
},
{
state:"Michigan",
race:"Senate",
candidate:"Alex Johnson",
party:"D",
polling:51
}
];


/*
GET National Map Data
*/

router.get("/",(req,res)=>{

res.json({
success:true,
totalRaces:races.length,
races
});

});

export default router;
