const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.9sqbqr2.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    const database = client.db("Scholar_Stream_DB");
    const userCollection = database.collection("users");
    const scholarshipCollection = database.collection("scholarships");

    app.get("/scholarships", async (req, res) => {
      const cursor = scholarshipCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/scholarship-details/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await scholarshipCollection.findOne(query);
      res.send(result);
    });

    app.get("/recent-scholarships", async (req, res) => {
      const cursor = scholarshipCollection
        .find()
        .limit(6)
        .sort({ scholarshipPostDate: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Steaming");
});

app.listen(port, () => {
  console.log("Server is Running");
});
