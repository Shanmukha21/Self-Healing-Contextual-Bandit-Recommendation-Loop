import os
import random
from typing import Dict, Any, List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymongo import MongoClient
from bson import ObjectId
from vowpalwabbit import pyvw

try:
    from backend.vw_formatter import to_adf_string, to_learn_string
except ModuleNotFoundError:
    from vw_formatter import to_adf_string, to_learn_string

# Initialize FastAPI
app = FastAPI(
    title="Self-Healing Contextual Bandit API",
    description="Backend API for online contextual bandit learning with Vowpal Wabbit and MongoDB"
)

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all for local development simplicity, or restrict to http://localhost:5173
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connect to MongoDB
MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/")
try:
    mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
    db = mongo_client["contextual_bandit_db"]
    logs_collection = db["recommendation_logs"]
    # Verify connection
    mongo_client.server_info()
    db_connected = True
except Exception as e:
    print(f"MongoDB connection failed: {e}")
    db_connected = False
    logs_collection = None

# Initialize Vowpal Wabbit Workspace
# --cb_explore_adf: Contextual Bandit with Action Dependent Features
# --epsilon 0.1: Keep 10% exploration rate
# -q UA: Cross-interact User (U) and Action (A) features
try:
    vw = pyvw.Workspace("--cb_explore_adf --epsilon 0.1 -q UA --quiet")
    vw_initialized = True
except Exception as e:
    print(f"Vowpal Wabbit initialization failed: {e}")
    vw = None
    vw_initialized = False

# Available actions (recommendations)
ACTIONS = [
    "Tech News Article",
    "Fashion Trends Video",
    "Gaming Live Stream",
    "Financial Market Digest"
]

class RecommendRequest(BaseModel):
    context: Dict[str, Any]

class RewardRequest(BaseModel):
    log_id: str
    reward: float

@app.get("/status")
def get_status():
    global db_connected
    if logs_collection is not None:
        try:
            mongo_client.server_info()
            db_connected = True
        except Exception:
            db_connected = False
    else:
        db_connected = False

    return {
        "status": "ok" if (db_connected and vw_initialized) else "error",
        "db_connected": db_connected,
        "vw_initialized": vw_initialized,
        "actions": ACTIONS
    }

@app.post("/recommend")
def recommend(request: RecommendRequest):
    if not vw_initialized:
        raise HTTPException(status_code=500, detail="Vowpal Wabbit is not initialized")
    if logs_collection is None:
        raise HTTPException(status_code=500, detail="MongoDB is not connected")
        
    context = request.context
    
    # 1. Format context and actions into VW's ADF string representation
    adf_string = to_adf_string(context, ACTIONS)
    
    # 2. Query Vowpal Wabbit to get the probability distribution (PMF)
    try:
        pmf = vw.predict(adf_string)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vowpal Wabbit prediction failed: {str(e)}")
        
    # 3. Sample an action index based on the predicted PMF
    try:
        chosen_idx = random.choices(range(len(ACTIONS)), weights=pmf, k=1)[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sampling action failed: {str(e)}")
        
    chosen_action = ACTIONS[chosen_idx]
    chosen_prob = pmf[chosen_idx]
    
    # 4. Save state of recommendation log (waiting for feedback) to MongoDB
    log_doc = {
        "context": context,
        "action": chosen_action,
        "action_index": chosen_idx,
        "pmf": [float(p) for p in pmf],
        "probability": float(chosen_prob),
        "reward": None,
        "timestamp": ObjectId().generation_time.isoformat()
    }
    
    try:
        result = logs_collection.insert_one(log_doc)
        log_id = str(result.inserted_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write log to MongoDB: {str(e)}")
        
    return {
        "log_id": log_id,
        "action": chosen_action
    }

@app.post("/reward")
def submit_reward(request: RewardRequest):
    if not vw_initialized:
        raise HTTPException(status_code=500, detail="Vowpal Wabbit is not initialized")
    if logs_collection is None:
        raise HTTPException(status_code=500, detail="MongoDB is not connected")
        
    log_id = request.log_id
    reward = request.reward
    
    # 1. Retrieve original log from MongoDB
    try:
        doc = logs_collection.find_one({"_id": ObjectId(log_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Log ID format")
        
    if not doc:
        raise HTTPException(status_code=404, detail="Recommendation log not found")
        
    if doc.get("reward") is not None:
        raise HTTPException(status_code=400, detail="Reward has already been recorded for this log")
        
    # 2. Update log with the received reward
    try:
        logs_collection.update_one({"_id": ObjectId(log_id)}, {"$set": {"reward": reward}})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update log in MongoDB: {str(e)}")
        
    # 3. Construct learning string and trigger online optimization (vw.learn)
    # Since VW minimizes cost, and our rewards are:
    # - Click: -1.0 (desired outcome -> low cost)
    # - Ignore: +1.0 (undesired outcome -> high cost)
    # We can pass the reward directly as the cost value.
    cost = reward
    chosen_idx = doc["action_index"]
    prob = doc["probability"]
    context = doc["context"]
    
    learn_string = to_learn_string(context, ACTIONS, chosen_idx, cost, prob)
    
    try:
        vw.learn(learn_string)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vowpal Wabbit learning update failed: {str(e)}")
        
    return {"status": "success"}

@app.post("/model/pmf")
def get_pmf(request: RecommendRequest):
    if not vw_initialized:
        raise HTTPException(status_code=500, detail="Vowpal Wabbit is not initialized")
        
    context = request.context
    
    adf_string = to_adf_string(context, ACTIONS)
    try:
        pmf = vw.predict(adf_string)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vowpal Wabbit prediction failed: {str(e)}")
        
    # Construct structured output for charting
    pmf_data = []
    for idx, act in enumerate(ACTIONS):
        pmf_data.append({
            "action": act,
            "probability": round(float(pmf[idx]) * 100, 2)
        })
        
    return {"pmf": pmf_data}

@app.get("/history")
def get_history():
    if logs_collection is None:
        raise HTTPException(status_code=500, detail="MongoDB is not connected")
        
    try:
        cursor = logs_collection.find({"reward": {"$ne": None}}).sort("_id", 1)
        history = list(cursor)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch history from MongoDB: {str(e)}")
        
    history_data = []
    running_sum = 0.0
    for idx, doc in enumerate(history):
        reward = float(doc["reward"])
        running_sum += reward
        cma = running_sum / (idx + 1)
        history_data.append({
            "step": idx + 1,
            "reward": reward,
            "moving_average": round(cma, 4),
            "action": doc["action"],
            "context": f"{doc['context'].get('time', '')} / {doc['context'].get('device', '')}"
        })
        
    return history_data

@app.post("/reset")
def reset_loop():
    global vw, logs_collection, db_connected, vw_initialized
    # Clear MongoDB logs
    if logs_collection is not None:
        try:
            logs_collection.delete_many({})
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to clear database: {str(e)}")
    
    # Re-initialize VW workspace to clear learning state
    try:
        vw = pyvw.Workspace("--cb_explore_adf --epsilon 0.1 -q UA --quiet")
        vw_initialized = True
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reinitialize VW workspace: {str(e)}")
        
    return {"status": "success"}
