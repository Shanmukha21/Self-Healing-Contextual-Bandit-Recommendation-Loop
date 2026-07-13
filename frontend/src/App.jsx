import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import {
  Zap,
  Play,
  Square,
  Sun,
  Moon,
  Smartphone,
  Monitor,
  CheckCircle,
  XCircle,
  RefreshCw,
  Info,
  AlertTriangle,
  Flame
} from 'lucide-react';
import {
  fetchStatus,
  fetchRecommendation,
  submitReward,
  fetchPMF,
  fetchHistory,
  resetLoop
} from './api';

function App() {
  const [time, setTime] = useState('morning');
  const [device, setDevice] = useState('mobile');
  
  const [pmfData, setPmfData] = useState([]);
  const [historyData, setHistoryData] = useState([]);
  
  const [recommendation, setRecommendation] = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [submittingReward, setSubmittingReward] = useState(false);
  
  const [dbConnected, setDbConnected] = useState(false);
  const [vwInitialized, setVwInitialized] = useState(false);
  
  const [autoSimActive, setAutoSimActive] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1000); // ms between steps
  
  const [stats, setStats] = useState({
    clicks: 0,
    ignores: 0,
    ctr: 0
  });

  const [notification, setNotification] = useState(null);

  // Load status and initial charts
  useEffect(() => {
    async function loadInitial() {
      try {
        const status = await fetchStatus();
        setDbConnected(status.db_connected);
        setVwInitialized(status.vw_initialized);
        
        // Load initial PMF for current selection
        const pmfRes = await fetchPMF({ time, device });
        setPmfData(pmfRes.pmf);
        
        // Load history
        const historyRes = await fetchHistory();
        setHistoryData(historyRes);
        updateStats(historyRes);
      } catch (err) {
        showNotification('Failed to connect to backend API. Make sure FastAPI server is running.', 'error');
      }
    }
    loadInitial();
  }, []);

  // Whenever context selection changes, reload PMF
  useEffect(() => {
    // Avoid fetching if auto simulation is active (since it handles its own PMF updates)
    if (autoSimActive) return;
    
    let isMounted = true;
    async function updatePmf() {
      try {
        const pmfRes = await fetchPMF({ time, device });
        if (isMounted) {
          setPmfData(pmfRes.pmf);
        }
      } catch (err) {
        console.error('Failed to load PMF:', err);
      }
    }
    updatePmf();
    return () => { isMounted = false; };
  }, [time, device, autoSimActive]);

  const updateStats = (history) => {
    const clicks = history.filter(h => h.reward === -1.0).length;
    const ignores = history.filter(h => h.reward === 1.0).length;
    const total = clicks + ignores;
    const ctr = total > 0 ? (clicks / total) * 100 : 0;
    setStats({ clicks, ignores, ctr: Number(ctr.toFixed(1)) });
  };

  const showNotification = (text, type = 'info') => {
    setNotification({ text, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  // Get Recommendation manually
  const handleGetRecommendation = async () => {
    if (loadingRec) return;
    setLoadingRec(true);
    setRecommendation(null);
    try {
      const res = await fetchRecommendation({ time, device });
      setRecommendation(res);
    } catch (err) {
      showNotification('Failed to get recommendation from backend.', 'error');
    } finally {
      setLoadingRec(false);
    }
  };

  // Submit Reward manually
  const handleReward = async (rewardVal) => {
    if (!recommendation || submittingReward) return;
    setSubmittingReward(true);
    try {
      await submitReward(recommendation.log_id, rewardVal);
      
      // Update notifications
      if (rewardVal === -1.0) {
        showNotification('Click reward logged! Model learned positive feedback.', 'success');
      } else {
        showNotification('Ignore reward logged! Model learned negative feedback.', 'info');
      }
      
      // Reset current recommendation state
      setRecommendation(null);
      
      // Refresh PMF and history
      const pmfRes = await fetchPMF({ time, device });
      setPmfData(pmfRes.pmf);
      
      const historyRes = await fetchHistory();
      setHistoryData(historyRes);
      updateStats(historyRes);
    } catch (err) {
      showNotification('Failed to submit reward to backend.', 'error');
    } finally {
      setSubmittingReward(false);
    }
  };

  // Reset Loop
  const handleReset = async () => {
    if (!window.confirm("Are you sure you want to reset the learning loop? This will clear all history from MongoDB and reset Vowpal Wabbit's online weights.")) {
      return;
    }
    setAutoSimActive(false);
    try {
      await resetLoop();
      showNotification('Learning loop successfully reset! All history cleared.', 'success');
      setRecommendation(null);
      
      // Refresh charts
      const pmfRes = await fetchPMF({ time, device });
      setPmfData(pmfRes.pmf);
      
      setHistoryData([]);
      setStats({ clicks: 0, ignores: 0, ctr: 0 });
    } catch (err) {
      showNotification('Failed to reset learning loop.', 'error');
    }
  };

  // Auto Simulation Logic
  useEffect(() => {
    if (!autoSimActive) return;
    
    let timerId;
    async function runSimStep() {
      try {
        const times = ['morning', 'evening'];
        const devices = ['mobile', 'desktop'];
        const randomTime = times[Math.floor(Math.random() * times.length)];
        const randomDevice = devices[Math.floor(Math.random() * devices.length)];
        
        // Sync context visual state
        setTime(randomTime);
        setDevice(randomDevice);
        
        // 1. Fetch Recommendation
        const rec = await fetchRecommendation({ time: randomTime, device: randomDevice });
        
        // 2. Sample Reward based on context rules:
        // - Morning + Mobile prefers "Fashion Trends Video" (80% CTR)
        // - Morning + Desktop prefers "Tech News Article" (85% CTR)
        // - Evening + Mobile prefers "Gaming Live Stream" (90% CTR)
        // - Evening + Desktop prefers "Financial Market Digest" (80% CTR)
        let clickProb = 0.10; // Default baseline CTR (10%)
        
        if (randomTime === 'morning' && randomDevice === 'mobile') {
          if (rec.action === 'Fashion Trends Video') clickProb = 0.80;
        } else if (randomTime === 'morning' && randomDevice === 'desktop') {
          if (rec.action === 'Tech News Article') clickProb = 0.85;
        } else if (randomTime === 'evening' && randomDevice === 'mobile') {
          if (rec.action === 'Gaming Live Stream') clickProb = 0.90;
        } else if (randomTime === 'evening' && randomDevice === 'desktop') {
          if (rec.action === 'Financial Market Digest') clickProb = 0.80;
        }
        
        const clicked = Math.random() < clickProb;
        const rewardVal = clicked ? -1.0 : 1.0;
        
        // 3. Submit Reward
        await submitReward(rec.log_id, rewardVal);
        
        // 4. Update local states for charts
        const pmfRes = await fetchPMF({ time: randomTime, device: randomDevice });
        setPmfData(pmfRes.pmf);
        
        const historyRes = await fetchHistory();
        setHistoryData(historyRes);
        updateStats(historyRes);
      } catch (err) {
        console.error('Error during auto-simulation step:', err);
      } finally {
        if (autoSimActive) {
          timerId = setTimeout(runSimStep, simSpeed);
        }
      }
    }
    
    timerId = setTimeout(runSimStep, 300);
    return () => clearTimeout(timerId);
  }, [autoSimActive, simSpeed]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative overflow-x-hidden">
      {/* Background Radial Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950/30 via-slate-950 to-slate-950 -z-10 pointer-events-none" />

      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md px-6 py-4 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600/20 p-2 rounded-xl border border-indigo-500/30 text-indigo-400">
            <Zap className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-200 via-indigo-100 to-indigo-300 bg-clip-text text-transparent">
              Self-Healing Contextual Bandit Recommendations
            </h1>
            <p className="text-xs text-slate-400">
              Online reinforcement learning loop with Vowpal Wabbit & MongoDB
            </p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-4 text-sm">
          {/* MongoDB Status */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/50">
            <div className={`w-2 h-2 rounded-full ${dbConnected ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'}`} />
            <div className={`w-2 h-2 rounded-full ${dbConnected ? 'bg-emerald-500' : 'bg-rose-500'} -ml-4`} />
            <span className="text-xs font-semibold text-slate-300">
              MongoDB: <span className={dbConnected ? 'text-emerald-400' : 'text-rose-400'}>{dbConnected ? 'Connected' : 'Offline'}</span>
            </span>
          </div>

          {/* VW Status */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/50">
            <div className={`w-2 h-2 rounded-full ${vwInitialized ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'}`} />
            <div className={`w-2 h-2 rounded-full ${vwInitialized ? 'bg-emerald-500' : 'bg-rose-500'} -ml-4`} />
            <span className="text-xs font-semibold text-slate-300">
              VW Model: <span className={vwInitialized ? 'text-emerald-400' : 'text-rose-400'}>{vwInitialized ? 'Ready' : 'Error'}</span>
            </span>
          </div>

          {/* Reset Button */}
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 hover:border-rose-600/60 rounded-lg transition-all duration-200 cursor-pointer"
            title="Reset Database and Model Weights"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset Loop</span>
          </button>
        </div>
      </header>

      {/* Notification Toast */}
      {notification && (
        <div className="fixed top-20 right-6 z-50 animate-slide-up">
          <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md ${
            notification.type === 'success' 
              ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300 glow-emerald' 
              : notification.type === 'error'
              ? 'bg-rose-950/80 border-rose-500/40 text-rose-300 glow-rose'
              : 'bg-slate-900/90 border-indigo-500/40 text-indigo-300 glow-indigo'
          }`}>
            {notification.type === 'success' && <CheckCircle className="w-5 h-5 flex-shrink-0" />}
            {notification.type === 'error' && <XCircle className="w-5 h-5 flex-shrink-0" />}
            {notification.type === 'info' && <Info className="w-5 h-5 flex-shrink-0" />}
            <span className="text-sm font-medium">{notification.text}</span>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto w-full">
        
        {/* LEFT PANEL: SIMULATION CONTROL (4 columns) */}
        <section className="lg:col-span-4 flex flex-col gap-6">
          <div className="glass-panel rounded-2xl p-5 flex flex-col gap-5 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -z-10" />
            
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
              <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                <Play className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold tracking-tight text-slate-100">
                Simulation Control
              </h2>
            </div>

            {/* Context Dropdowns */}
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5 mb-1.5">
                  <Sun className="w-3.5 h-3.5 text-indigo-400" />
                  TIME CONTEXT
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => !autoSimActive && setTime('morning')}
                    disabled={autoSimActive}
                    className={`flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium border transition-all duration-200 cursor-pointer ${
                      time === 'morning'
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200 shadow-[0_0_15px_-3px_rgba(99,102,241,0.2)]'
                        : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 text-slate-400'
                    } ${autoSimActive ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <Sun className="w-4 h-4" />
                    Morning
                  </button>
                  <button
                    onClick={() => !autoSimActive && setTime('evening')}
                    disabled={autoSimActive}
                    className={`flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium border transition-all duration-200 cursor-pointer ${
                      time === 'evening'
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200 shadow-[0_0_15px_-3px_rgba(99,102,241,0.2)]'
                        : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 text-slate-400'
                    } ${autoSimActive ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <Moon className="w-4 h-4" />
                    Evening
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5 mb-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                  DEVICE CONTEXT
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => !autoSimActive && setDevice('mobile')}
                    disabled={autoSimActive}
                    className={`flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium border transition-all duration-200 cursor-pointer ${
                      device === 'mobile'
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200 shadow-[0_0_15px_-3px_rgba(99,102,241,0.2)]'
                        : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 text-slate-400'
                    } ${autoSimActive ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <Smartphone className="w-4 h-4" />
                    Mobile
                  </button>
                  <button
                    onClick={() => !autoSimActive && setDevice('desktop')}
                    disabled={autoSimActive}
                    className={`flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium border transition-all duration-200 cursor-pointer ${
                      device === 'desktop'
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200 shadow-[0_0_15px_-3px_rgba(99,102,241,0.2)]'
                        : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 text-slate-400'
                    } ${autoSimActive ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <Monitor className="w-4 h-4" />
                    Desktop
                  </button>
                </div>
              </div>
            </div>

            {/* Recommendation Generator & Actions */}
            <div className="flex flex-col gap-4 border-t border-slate-800/80 pt-4 mt-2">
              <button
                onClick={handleGetRecommendation}
                disabled={autoSimActive || loadingRec || recommendation !== null}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition-all duration-300 cursor-pointer ${
                  autoSimActive 
                    ? 'bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed'
                    : recommendation !== null
                    ? 'bg-indigo-900/20 border border-indigo-800 text-indigo-400 opacity-80 cursor-default'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 hover:scale-[1.01]'
                }`}
              >
                {loadingRec ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Predicting...
                  </span>
                ) : recommendation !== null ? (
                  'Pending Feedback'
                ) : (
                  'Get Recommendation'
                )}
              </button>

              {/* Display Result Card */}
              {recommendation && (
                <div className="animate-slide-up bg-slate-900/80 border border-indigo-500/30 rounded-xl p-4 flex flex-col gap-3 glow-indigo relative">
                  <div className="absolute top-2.5 right-2.5 bg-indigo-500/10 px-2 py-0.5 rounded text-[10px] font-bold text-indigo-300 uppercase border border-indigo-500/20">
                    ADF Output
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-0.5">RECOMMENDED ACTION</span>
                    <span className="text-sm font-bold text-indigo-200">{recommendation.action}</span>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReward(-1.0)}
                      disabled={submittingReward}
                      className="flex-1 py-2 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/50 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Click (Reward -1)
                    </button>
                    <button
                      onClick={() => handleReward(1.0)}
                      disabled={submittingReward}
                      className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700/80 text-slate-300 border border-slate-700 hover:border-slate-600 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer"
                    >
                      <XCircle className="w-4 h-4" />
                      Ignore (Reward +1)
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* AUTO SIMULATOR PANEL */}
          <div className={`glass-panel rounded-2xl p-5 shadow-xl transition-all duration-300 relative overflow-hidden border ${
            autoSimActive ? 'animate-pulse-border border-indigo-500/50 glow-indigo' : 'border-slate-800/80'
          }`}>
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Flame className={`w-4 h-4 ${autoSimActive ? 'text-orange-400 animate-bounce' : 'text-slate-400'}`} />
                <h2 className="text-base font-bold tracking-tight text-slate-100">
                  Auto-Simulation Loop
                </h2>
              </div>
              {autoSimActive && (
                <span className="bg-indigo-600/20 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded border border-indigo-500/30 animate-pulse">
                  ACTIVE
                </span>
              )}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Launches an automated test loop that repeatedly selects random contexts, retrieves recommendations, simulates user clicks/ignores based on preset profiles, and runs updates.
            </p>

            <div className="flex flex-col gap-4">
              {/* Simulation Speed Slider */}
              <div className="bg-slate-900/30 border border-slate-800/50 rounded-xl p-3">
                <div className="flex justify-between text-xs font-semibold text-slate-400 mb-1.5">
                  <span>STEP INTERVAL</span>
                  <span className="text-indigo-400 font-bold">{simSpeed}ms</span>
                </div>
                <input
                  type="range"
                  min="200"
                  max="3000"
                  step="100"
                  value={simSpeed}
                  onChange={(e) => setSimSpeed(Number(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>

              {/* Start/Stop Button */}
              <button
                onClick={() => setAutoSimActive(!autoSimActive)}
                className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-300 cursor-pointer ${
                  autoSimActive
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                }`}
              >
                {autoSimActive ? (
                  <>
                    <Square className="w-4 h-4 fill-white" />
                    Stop Simulation
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white animate-pulse" />
                    Start Auto-Simulation
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        {/* RIGHT PANEL: MODEL INSIGHTS (8 columns) */}
        <section className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Statistical Highlights */}
          <div className="grid grid-cols-3 gap-4">
            <div className="glass-card rounded-2xl p-4 border border-slate-800/50 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Clicks</span>
              <span className="text-2xl font-bold text-emerald-400 mt-1">{stats.clicks}</span>
              <span className="text-[9px] text-slate-500 mt-1">Reward of -1.0</span>
            </div>
            <div className="glass-card rounded-2xl p-4 border border-slate-800/50 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Ignores</span>
              <span className="text-2xl font-bold text-slate-300 mt-1">{stats.ignores}</span>
              <span className="text-[9px] text-slate-500 mt-1">Reward of +1.0</span>
            </div>
            <div className="glass-card rounded-2xl p-4 border border-slate-800/50 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Overall CTR</span>
              <span className="text-2xl font-bold text-indigo-400 mt-1">{stats.ctr}%</span>
              <span className="text-[9px] text-slate-500 mt-1">Clicks / Total interactions</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Live PMF Chart */}
            <div className="glass-card rounded-2xl p-5 border border-slate-800/50 flex flex-col shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-200">Live Probability Distribution</h3>
                  <span className="text-[10px] text-indigo-400 uppercase font-semibold">
                    Context: {time} / {device}
                  </span>
                </div>
                <div className="text-xs bg-slate-800/60 px-2 py-0.5 rounded text-slate-400 border border-slate-700/50">
                  PMF Chart
                </div>
              </div>

              <div className="h-64 w-full">
                {pmfData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pmfData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="barGlow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.15}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                      <XAxis 
                        dataKey="action" 
                        stroke="#94a3b8" 
                        fontSize={8}
                        tickLine={false}
                        tickFormatter={(val) => val.split(' ')[0]} // Shorten action names for labels
                      />
                      <YAxis 
                        stroke="#94a3b8" 
                        domain={[0, 100]} 
                        fontSize={9}
                        tickLine={false}
                        tickFormatter={(val) => `${val}%`}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                        contentStyle={{ 
                          backgroundColor: '#0f172a', 
                          border: '1px solid rgba(255,255,255,0.1)', 
                          borderRadius: '12px' 
                        }}
                        labelStyle={{ fontWeight: 'bold', color: '#cbd5e1', fontSize: '11px' }}
                        itemStyle={{ fontSize: '11px', color: '#818cf8' }}
                        formatter={(value) => [`${value}%`, 'Probability']}
                      />
                      <Bar dataKey="probability" fill="url(#barGlow)" radius={[6, 6, 0, 0]}>
                        {pmfData.map((entry, index) => {
                          const isHighest = entry.probability === Math.max(...pmfData.map(d => d.probability));
                          return (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={isHighest ? 'url(#barGlow)' : '#1e293b'} 
                              stroke={isHighest ? '#818cf8' : '#334155'}
                              strokeWidth={1}
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-slate-500">
                    No data available. Get a recommendation to see PMF.
                  </div>
                )}
              </div>
            </div>

            {/* Learning Curve Chart */}
            <div className="glass-card rounded-2xl p-5 border border-slate-800/50 flex flex-col shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-200">Learning Curve</h3>
                  <p className="text-[10px] text-emerald-400 font-semibold uppercase">
                    Moving Average Reward
                  </p>
                </div>
                <div className="text-xs bg-slate-800/60 px-2 py-0.5 rounded text-slate-400 border border-slate-700/50" title="A downward curve shows successful optimization (clicks are negative cost)">
                  -1.0 is Optimal
                </div>
              </div>

              <div className="h-64 w-full">
                {historyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                      <XAxis 
                        dataKey="step" 
                        stroke="#94a3b8" 
                        fontSize={9}
                        tickLine={false} 
                      />
                      <YAxis 
                        stroke="#94a3b8" 
                        domain={[-1.0, 1.0]} 
                        ticks={[-1.0, -0.5, 0, 0.5, 1.0]}
                        fontSize={9}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{ 
                          backgroundColor: '#0f172a', 
                          border: '1px solid rgba(255,255,255,0.1)', 
                          borderRadius: '12px' 
                        }}
                        labelStyle={{ fontWeight: 'bold', color: '#cbd5e1', fontSize: '11px' }}
                        itemStyle={{ fontSize: '11px' }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="moving_average" 
                        name="Avg Cost (CMA)"
                        stroke="#10b981" 
                        strokeWidth={2.5} 
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-xs text-center px-6 leading-relaxed">
                    No reward history logged yet. Complete manual recommendations or start the Auto-Simulation to compile a training history.
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* PRESET PREFERENCES TABLE (Visual Guide) */}
          <div className="glass-card rounded-2xl p-5 border border-slate-800/50 shadow-lg">
            <h3 className="text-sm font-bold text-slate-200 border-b border-slate-800/80 pb-2.5 mb-3 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-indigo-400" />
              Predefined User Preferences (Target Convergences)
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              To verify that the Contextual Bandit correctly optimizes and handles the exploitation-exploration trade-off, the simulated user preferences are programmed as follows:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                    <th className="py-2 px-3">Context Time</th>
                    <th className="py-2 px-3">Context Device</th>
                    <th className="py-2 px-3 text-indigo-400">Preferred Action (80%+ CTR)</th>
                    <th className="py-2 px-3">Other Actions CTR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  <tr>
                    <td className="py-2 px-3 font-medium flex items-center gap-1"><Sun className="w-3.5 h-3.5 text-indigo-400" /> Morning</td>
                    <td className="py-2 px-3"><span className="flex items-center gap-1"><Smartphone className="w-3.5 h-3.5 text-indigo-400" /> Mobile</span></td>
                    <td className="py-2 px-3 font-semibold text-indigo-200">Fashion Trends Video</td>
                    <td className="py-2 px-3 text-slate-500">10% (Cost ~ +0.8)</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-medium flex items-center gap-1"><Sun className="w-3.5 h-3.5 text-indigo-400" /> Morning</td>
                    <td className="py-2 px-3"><span className="flex items-center gap-1"><Monitor className="w-3.5 h-3.5 text-indigo-400" /> Desktop</span></td>
                    <td className="py-2 px-3 font-semibold text-indigo-200">Tech News Article</td>
                    <td className="py-2 px-3 text-slate-500">15% (Cost ~ +0.7)</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-medium flex items-center gap-1"><Moon className="w-3.5 h-3.5 text-indigo-400" /> Evening</td>
                    <td className="py-2 px-3"><span className="flex items-center gap-1"><Smartphone className="w-3.5 h-3.5 text-indigo-400" /> Mobile</span></td>
                    <td className="py-2 px-3 font-semibold text-indigo-200">Gaming Live Stream</td>
                    <td className="py-2 px-3 text-slate-500">10% (Cost ~ +0.8)</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 font-medium flex items-center gap-1"><Moon className="w-3.5 h-3.5 text-indigo-400" /> Evening</td>
                    <td className="py-2 px-3"><span className="flex items-center gap-1"><Monitor className="w-3.5 h-3.5 text-indigo-400" /> Desktop</span></td>
                    <td className="py-2 px-3 font-semibold text-indigo-200">Financial Market Digest</td>
                    <td className="py-2 px-3 text-slate-500">20% (Cost ~ +0.6)</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-4 bg-slate-900/50 rounded-xl p-3 border border-indigo-950 flex items-start gap-2.5">
              <AlertTriangle className="w-4.5 h-4.5 text-indigo-400 flex-shrink-0 mt-0.5 animate-pulse" />
              <div className="text-[11px] text-slate-400 leading-relaxed">
                <span className="font-bold text-indigo-300 block mb-0.5">Exploration vs. Exploitation</span>
                With epsilon set to 10% (<code className="bg-slate-950 px-1 py-0.2 rounded text-[10px]">--epsilon 0.1</code>), the model allocates a baseline 2.5% probability to each of the non-optimal actions even after complete training to continually explore context changes. The preferred action will peak at around 92.5%.
              </div>
            </div>
          </div>

        </section>

      </main>

      {/* Footer */}
      <footer className="py-4 border-t border-slate-900 text-center text-xs text-slate-500 mt-auto bg-slate-950/80">
        Self-Healing Bandit Recommend Loop App &copy; {new Date().getFullYear()} - Designed with Premium Rich Aesthetics.
      </footer>
    </div>
  );
}

export default App;
