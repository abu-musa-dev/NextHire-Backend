const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();
const jwt = require("jsonwebtoken");
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = "mongodb://abumusa0740:a5UP5N4crbNK0JIr@ac-bdaocrj-shard-00-00.crf1cq0.mongodb.net:27017,ac-bdaocrj-shard-00-01.crf1cq0.mongodb.net:27017,ac-bdaocrj-shard-00-02.crf1cq0.mongodb.net:27017/?replicaSet=atlas-12uar9-shard-0&ssl=true&authSource=admin";

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Global collections
let jobsCollection;
let applicationsCollection;
let jobSeekersCollection;
let employersCollection;
let viewsCollection;
let messagesCollection;

// Connect and run
async function run() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas!");

    const db = client.db("nexthire");

    jobsCollection = db.collection("jobs");
    applicationsCollection = db.collection("applications");
    jobSeekersCollection = db.collection("jobseekers");
    employersCollection = db.collection("employers");
    viewsCollection = db.collection("views");
    messagesCollection = db.collection("messages");

    const adminDb = client.db().admin();
    const dbs = await adminDb.listDatabases();
    console.log("Databases:", dbs.databases);
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}

run();

// <-------Middleware to verify JWT---------->
const verifyToken = (req, res, next) => {
  const token = req.header("Authorization");

  console.log("Token from header:", token); // Check if token is being sent

  if (!token) {
    return res.status(401).json({ message: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded JWT:", decoded); // Log the decoded JWT for debugging
    req.user = decoded;  // Attach user data to request
    next();
  } catch (err) {
    console.error("❌ Invalid token:", err);
    res.status(400).json({ message: "Invalid token" });
  }
};


// <-------Login route with JWT creation-------->
app.post("/login", async (req, res) => {
  const { email } = req.body;

  try {
    const candidate = await jobSeekersCollection.findOne({ email });
    const employer = await employersCollection.findOne({ email });
    const user = candidate || employer;

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Ensure that role and userInfo are correctly passed
    const token = jwt.sign({ email: user.email, role: user.role, userInfo: user }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    res.json({
      token,
      role: user.role,
      userInfo: user, // Send the user info correctly here
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ------------- jobseekers Registration -----------------

app.post('/jobseekers/register', async (req, res) => {
  const { firstName, lastName, username, email, role, uid } = req.body;

  if (!username || !email || !firstName || !lastName || !role || !uid) {
    return res.status(400).send({ message: "All fields are required" });
  }

  try {
    // 🔍 Check if email already exists
    const existingUser = await jobSeekersCollection.findOne({ email });
    if (existingUser) {
      return res.status(409).send({ message: "Email already in use" });
    }

    // ✅ Insert into MongoDB
    const result = await jobSeekersCollection.insertOne({
      firstName,
      lastName,
      username,
      email,
      role,
      uid, // Save UID from Firebase
      createdAt: new Date()
    });

    res.status(201).send({ message: "Job Seeker registered successfully", id: result.insertedId });
  } catch (err) {
    console.error("❌ Registration error:", err);
    res.status(500).send({ message: "Registration failed" });
  }
});



// ------------- Employer Registration -----------------


app.post('/employers/register', async (req, res) => {
  try {
    const employer = req.body;

    // ✅ Only check for firstName and email (password বাদ দেওয়া হলো)
    if (!employer.firstName || !employer.email) {
      return res.status(400).send({ error: "Missing required fields" });
    }

    // 🔍 Check if email already exists
    const existingEmployer = await employersCollection.findOne({ email: employer.email });
    if (existingEmployer) {
      return res.status(409).send({ error: "Email already in use" });
    }

    // ✅ Insert employer data into DB
    const result = await employersCollection.insertOne(employer);
    res.status(201).send(result);
  } catch (error) {
    console.error("❌ Error registering employer:", error);
    res.status(500).send({ error: "Employer registration failed" });
  }
});




// <--------Role-based access control ----------->
app.get('/dashboard', verifyToken, (req, res) => {
  console.log("User role in dashboard:", req.user.role); // Log the role of the logged-in user

  if (req.user.role === "Employer") {
    res.send("Welcome Employer!");
  } else if (req.user.role === "Candidate") {
    res.send("Welcome Candidate!");
  } else {
    console.log("Access forbidden due to insufficient permissions for role:", req.user.role);
    res.status(403).send("Access forbidden: insufficient permissions.");
  }
});


app.get('/applications', async (req, res) => {
  try {
    const posterEmail = req.query.posterEmail;
    console.log("Poster email from request:", posterEmail);  // Debug log
    const apps = await applicationsCollection.find({ posterEmail }).toArray();
    res.send(apps);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).send({ error: "Failed to fetch applications" });
  }
});



app.patch('/applications/:id/status', async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  if (!status) {
    return res.status(400).send({ message: "Status is required" });
  }

  try {
    const result = await applicationsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).send({ message: "Application not found or no change made" });
    }

    res.send({ message: "Status updated successfully" });
  } catch (error) {
    console.error("❌ Error updating status:", error);
    res.status(500).send({ message: "Failed to update status" });
  }
});

// Get jobs by user's email
app.get('/jobs', async (req, res) => {
  try {
    const { email } = req.query;

    let query = {};
    if (email) {
      query.createdBy = email;
    }

    const jobs = await jobsCollection.find(query).toArray();
    res.send(jobs);
  } catch (error) {
    console.error("❌ Error fetching jobs:", error);
    res.status(500).send({ error: "Failed to fetch jobs" });
  }
});

app.get("/jobs/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const job = await jobsCollection.findOne({ _id: new ObjectId(id) }); // ✅ ObjectId হওয়া লাগবে
    if (!job) {
      return res.status(404).send({ message: "Job not found" });
    }
    res.send(job);
  } catch (err) {
    console.error("❌ Error fetching job by ID:", err);
    res.status(500).send({ message: "Internal server error" });
  }
});




app.delete("/jobs/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await jobsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Job not found" });
    }

    res.send({ message: "Job deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting job:", err);
    res.status(500).send({ message: "Failed to delete job" });
  }
});

app.patch("/jobs/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).send({ message: "Status is required" });
  }

  try {
    const result = await jobsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).send({ message: "Job not found or status not changed" });
    }

    res.send({ message: "Status updated successfully" });
  } catch (err) {
    console.error("❌ Error updating job status:", err);
    res.status(500).send({ message: "Failed to update status" });
  }
});




app.post('/applications', async (req, res) => {
  try {
    const application = req.body;

    // 🔍 Find the job using jobId
    const job = await jobsCollection.findOne({ _id: new ObjectId(application.jobId) });

    // 🟩 এখানে console log গুলো বসাও
    console.log("🔎 Job found:", job);
    console.log("📧 job.createdBy:", job?.createdBy);

    if (!job) {
      return res.status(404).send({ error: "Job not found" });
    }

    // ✅ Set posterEmail
    application.posterEmail = job.createdBy || null;

    const result = await applicationsCollection.insertOne(application);
    res.status(201).send(result);
  } catch (error) {
    console.error("Error submitting application:", error);
    res.status(500).send({ error: "Failed to apply" });
  }
});




app.delete("/applications/:id", async (req, res) => {
  const { id } = req.params;
  const { userEmail } = req.body;

  try {
    const application = await applicationsCollection.findOne({ _id: new ObjectId(id) });

    if (!application) {
      return res.status(404).send({ message: "Application not found" });
    }

    if (application.email !== userEmail) {
      return res.status(403).send({ message: "You can only withdraw your own applications" });
    }

    const result = await applicationsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Application not found" });
    }

    res.send({ message: "Application withdrawn successfully" });
  } catch (err) {
    console.error("Error withdrawing application:", err);
    res.status(500).send({ message: "Failed to withdraw application" });
  }
});


// ------------- Applications -----------------

app.post('/views/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    // Find the job and increment the view count
    const job = await jobsCollection.findOne({ _id: new ObjectId(jobId) });

    if (!job) {
      return res.status(404).send({ error: "Job not found" });
    }

    // Increment view count
    const updatedJob = await jobsCollection.updateOne(
      { _id: new ObjectId(jobId) },
      { $inc: { views: 1 } }  // Assuming there is a `views` field in the job schema
    );

    if (updatedJob.modifiedCount > 0) {
      return res.status(200).send({ message: "View count updated" });
    } else {
      return res.status(500).send({ error: "Failed to update view count" });
    }
  } catch (error) {
    console.error("Error updating view count:", error);
    res.status(500).send({ error: "Failed to update view count" });
  }
});


app.patch("/jobs/:id", async (req, res) => {
  const { id } = req.params;
  const { title, category, location, status } = req.body;

  try {
    // জবটি খুঁজে বের করুন এবং আপডেট করুন
    const result = await jobsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          title,
          category,
          location,
          status, // স্ট্যাটাসও আপডেট করা হবে
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).send({ message: "Job not found or no changes made" });
    }

    res.send({ message: "Job updated successfully" });
  } catch (err) {
    console.error("❌ Error updating job:", err);
    res.status(500).send({ message: "Failed to update job" });
  }
});

app.delete("/jobs/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await jobsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Job not found" });
    }

    res.send({ message: "Job deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting job:", err);
    res.status(500).send({ message: "Failed to delete job" });
  }
});


app.get("/jobs/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const job = await jobsCollection.findOne({ _id: new ObjectId(id) });
    if (!job) {
      return res.status(404).send({ message: "Job not found" });
    }
    res.send(job);
  } catch (err) {
    console.error("❌ Error fetching job:", err);
    res.status(500).send({ message: "Failed to fetch job details" });
  }
});


// ------------- Job Posts -----------------


app.post("/jobs", async (req, res) => {
  const job = req.body;

  try {
    if (!jobsCollection) {
      return res.status(500).send({ message: "Database not initialized" });
    }

    // 🔓 JWT ছাড়া সরাসরি body থেকে email নাও
    const result = await jobsCollection.insertOne(job);
    res.status(200).send(result);
  } catch (err) {
    console.error("❌ Error posting job:", err);
    res.status(500).send({ message: "Failed to post job" });
  }
});


app.post('/messages', async (req, res) => {
  try {
    const { senderEmail, receiverEmail, messageText } = req.body;

    if (!senderEmail || !receiverEmail || !messageText) {
      return res.status(400).send({ message: 'All fields are required' });
    }

    const newMessage = {
      senderEmail,
      receiverEmail,
      messageText,
      date: new Date(), // Store the current date and time
    };

    const result = await messagesCollection.insertOne(newMessage);
    res.status(201).send({ message: 'Message sent successfully', message: result.ops[0] });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).send({ error: 'Failed to send message' });
  }
});

// Root route
app.get('/', (req, res) => {
  res.send('NextHire backend is running and connected to MongoDB!');
});

//--------profile update -------




// Start server
app.listen(PORT, () => {
  console.log(`🌐 Server is running on http://localhost:${PORT}`);
});
