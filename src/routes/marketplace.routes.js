import express from "express";

const router = express.Router();

/*
In production this would be a database table
For now we simulate a consultant marketplace
*/

let consultants = [
{
id: 1,
name: "Blue Wave Digital",
service: "Digital Advertising",
state: "DC",
rating: 4.8
},
{
id: 2,
name: "Victory Mail",
service: "Direct Mail",
state: "VA",
rating: 4.6
},
{
id: 3,
name: "Strategic Polling Group",
service: "Polling",
state: "NY",
rating: 4.9
}
];

/*
GET all consultants
*/
router.get("/", (req,res)=>{
res.json({
success:true,
count:consultants.length,
consultants
});
});

/*
Search consultants
*/
router.get("/search",(req,res)=>{

const {service,state} = req.query;

let results = consultants;

if(service){
results = results.filter(c =>
c.service.toLowerCase().includes(service.toLowerCase())
);
}

if(state){
results = results.filter(c =>
c.state.toLowerCase() === state.toLowerCase()
);
}

res.json({
success:true,
count:results.length,
consultants:results
});

});

/*
Add consultant
*/
router.post("/",(req,res)=>{

const newConsultant = {
id: consultants.length + 1,
...req.body
};

consultants.push(newConsultant);

res.json({
success:true,
consultant:newConsultant
});

});

export default router;
