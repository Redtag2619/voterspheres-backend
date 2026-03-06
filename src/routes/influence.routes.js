import express from "express";

const router = express.Router();

/*
Simulated political influence network
*/

let network = [
{
donor:"Michael Thompson",
pac:"Future America PAC",
candidate:"Jane Smith",
amount:500000
},
{
donor:"Linda Chen",
pac:"Tech Progress PAC",
candidate:"Tom Rivera",
amount:350000
},
{
donor:"Robert Garcia",
pac:"Real Estate Growth PAC",
candidate:"Jane Smith",
amount:200000
}
];


/*
GET full influence network
*/

router.get("/",(req,res)=>{

res.json({
success:true,
connections: network.length,
network
});

});


/*
Trace influence for a candidate
*/

router.get("/candidate/:name",(req,res)=>{

const candidate = req.params.name;

const influence = network.filter(n =>
n.candidate === candidate
);

res.json({
success:true,
candidate,
influence
});

});

export default router;
