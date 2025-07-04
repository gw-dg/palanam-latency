import React, { useState, useRef, useEffect, useCallback } from "react";

const VideoPlayer = () => {
  const [sessionId, setSessionId] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [classifications, setClassifications] = useState(new Map());
  const [currentClassification, setCurrentClassification] = useState(null);
  const [videoInfo, setVideoInfo] = useState(null);
  
  // New state for skip functionality
  const [skipSettings, setSkipSettings] = useState({
    enabled: true,
    skipDuration: 5, // seconds to skip forward
    confidenceThreshold: 0.7, // only skip if confidence > 70%
    bufferTime: 1.0, // seconds to buffer before/after NSFW content
  });
  const [isSkipping, setIsSkipping] = useState(false);
  const [skipHistory, setSkipHistory] = useState([]);

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastProcessedTime = useRef(-1);
  const skipTimeoutRef = useRef(null);

  // Clean up function
  const cleanup = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (skipTimeoutRef.current) {
      clearTimeout(skipTimeoutRef.current);
      skipTimeoutRef.current = null;
    }
    if (videoSrc && videoSrc.startsWith("blob:")) {
      URL.revokeObjectURL(videoSrc);
    }
    setIsConnected(false);
    setIsSkipping(false);
  }, [videoSrc]);

  // Skip function - handles the actual skipping logic
  const skipNSFWContent = useCallback((classification) => {
    if (!videoRef.current || !skipSettings.enabled || isSkipping) return;

    const { confidence, timestamp, is_nsfw } = classification;
    
    // Only skip if confidence is above threshold
    if (!is_nsfw || confidence < skipSettings.confidenceThreshold) return;

    setIsSkipping(true);
    const currentTime = videoRef.current.currentTime;
    
    // Calculate skip target time
    const skipToTime = Math.min(
      currentTime + skipSettings.skipDuration,
      videoRef.current.duration - 1
    );

    // Record skip event
    const skipEvent = {
      fromTime: currentTime,
      toTime: skipToTime,
      timestamp: new Date().toISOString(),
      confidence: confidence,
      label: classification.label
    };
    
    setSkipHistory(prev => [...prev, skipEvent]);

    // Perform the skip
    videoRef.current.currentTime = skipToTime;
    
    // Show skip notification
    console.log(`Skipped NSFW content: ${currentTime.toFixed(1)}s → ${skipToTime.toFixed(1)}s`);
    
    // Reset skipping state after a brief delay
    skipTimeoutRef.current = setTimeout(() => {
      setIsSkipping(false);
    }, 1000);

  }, [skipSettings, isSkipping]);

  // Real-time frame processing
  const processCurrentFrame = useCallback(async () => {
    if (
      !videoRef.current ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN ||
      isSkipping
    ) {
      return;
    }

    const currentTime = videoRef.current.currentTime;
    const timeKey = Math.floor(currentTime * 2) / 2;

    if (!videoRef.current.paused && timeKey !== lastProcessedTime.current) {
      lastProcessedTime.current = timeKey;

      wsRef.current.send(
        JSON.stringify({
          type: "process_frame",
          timestamp: currentTime,
        })
      );
    }
  }, [isSkipping]);

  // Update overlay and handle skipping
  const updateOverlay = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) {
      animationFrameRef.current = requestAnimationFrame(updateOverlay);
      return;
    }

    const currentTime = videoRef.current.currentTime;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // If skipping, draw black overlay covering the entire video
    if (isSkipping) {
      // Fill entire canvas with black
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw skip message
      ctx.font = "bold 32px Arial";
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;
      
      const skipText = "SKIPPING NSFW CONTENT";
      const textWidth = ctx.measureText(skipText).width;
      const centerX = (canvas.width - textWidth) / 2;
      const centerY = canvas.height / 2;
      
      ctx.strokeText(skipText, centerX, centerY);
      ctx.fillText(skipText, centerX, centerY);
      
      // Optional: Add a loading spinner or progress indicator
      const spinnerRadius = 30;
      const spinnerX = centerX + textWidth / 2 + 50;
      const spinnerY = centerY;
      const angle = (Date.now() / 100) % (2 * Math.PI);
      
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(spinnerX, spinnerY, spinnerRadius, angle, angle + Math.PI * 1.5);
      ctx.stroke();
    } else {
      // Normal overlay when not skipping
      // Find the most recent classification for current time
      const timeKey = Math.floor(currentTime * 2) / 2;
      let relevantClassification = null;

      for (let i = 0; i <= 4; i++) {
        const checkTime = timeKey - i * 0.5;
        if (classifications.has(checkTime)) {
          relevantClassification = classifications.get(checkTime);
          break;
        }
      }

      if (relevantClassification) {
        setCurrentClassification(relevantClassification);

        // Draw classification overlay
        const { label, confidence, is_nsfw } = relevantClassification;
        const text = `${label.toUpperCase()} (${(confidence * 100).toFixed(1)}%)`;

        ctx.font = "bold 24px Arial";
        ctx.fillStyle = is_nsfw ? "#ff4444" : "#44ff44";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;

        ctx.strokeText(text, 20, 40);
        ctx.fillText(text, 20, 40);

        // Draw confidence bar
        const barWidth = 200;
        const barHeight = 8;
        const barX = 20;
        const barY = 50;

        ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
        ctx.fillRect(barX, barY, barWidth, barHeight);

        ctx.fillStyle = is_nsfw ? "#ff4444" : "#44ff44";
        ctx.fillRect(barX, barY, barWidth * confidence, barHeight);
      }
    }

    processCurrentFrame();
    animationFrameRef.current = requestAnimationFrame(updateOverlay);
  }, [classifications, processCurrentFrame, isSkipping]);

  // Start overlay animation
  useEffect(() => {
    if (videoRef.current && canvasRef.current) {
      animationFrameRef.current = requestAnimationFrame(updateOverlay);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [updateOverlay]);

  // Handle video metadata loaded
  const handleVideoLoaded = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.style.width = video.offsetWidth + "px";
      canvas.style.height = video.offsetHeight + "px";
    }
  };

  // WebSocket message handler with skip logic
  const handleWebSocketMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "video_info":
          setVideoInfo(data);
          console.log("Video info received:", data);
          break;

        case "classification":
          const timeKey = Math.floor(data.timestamp * 2) / 2;
          setClassifications((prev) => new Map(prev.set(timeKey, data)));
          console.log("Classification received:", data);
          
          // Handle auto-skip
          if (data.is_nsfw && skipSettings.enabled) {
            skipNSFWContent(data);
          }
          break;

        case "connection_established":
          setIsConnected(true);
          console.log("WebSocket connection established");
          break;

        case "error":
          setError(data.message);
          setIsConnected(false);
          break;

        default:
          console.log("Unknown message type:", data.type);
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
    }
  }, [skipSettings, skipNSFWContent]);

  // Start WebSocket connection
  const startWebSocketConnection = useCallback(
    (sessionId) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }

      const wsUrl = `ws://localhost:8000/ws/${sessionId}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("WebSocket connected");
        setError(null);
        ws.send(JSON.stringify({ type: "connect" }));
      };

      ws.onmessage = handleWebSocketMessage;

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setError("WebSocket connection failed. Make sure the server is running.");
        setIsConnected(false);
      };

      ws.onclose = (event) => {
        console.log("WebSocket disconnected", event.code, event.reason);
        setIsConnected(false);

        if (event.code !== 1000 && sessionId) {
          setTimeout(() => {
            console.log("Attempting to reconnect WebSocket...");
            startWebSocketConnection(sessionId);
          }, 3000);
        }
      };

      wsRef.current = ws;
    },
    [handleWebSocketMessage]
  );

  // Handle file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file || !file.type.startsWith("video/")) {
      setError("Please select a valid video file.");
      return;
    }

    setIsUploading(true);
    setError(null);
    cleanup();

    try {
      const localVideoUrl = URL.createObjectURL(file);
      setVideoSrc(localVideoUrl);

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("http://localhost:8000/upload-video/", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const newSessionId = result.session_id;
      setSessionId(newSessionId);

      setTimeout(() => startWebSocketConnection(newSessionId), 1000);
    } catch (error) {
      console.error("Error uploading video:", error);
      setError(error.message);
      if (videoSrc && videoSrc.startsWith("blob:")) {
        URL.revokeObjectURL(videoSrc);
        setVideoSrc(null);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleNewUpload = () => {
    cleanup();
    setSessionId(null);
    setVideoSrc(null);
    setClassifications(new Map());
    setCurrentClassification(null);
    setVideoInfo(null);
    setError(null);
    setSkipHistory([]);
    lastProcessedTime.current = -1;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return (
    <div className="max-w-4xl mx-auto p-6 font-sans">
      <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">
        Real-time NSFW Video Detector with Auto-Skip
      </h1>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <div className="flex justify-between items-start">
            <p className="text-red-700 font-medium">Error: {error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700 font-bold ml-4">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Skip Settings Panel */}
      {videoSrc && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-gray-800 mb-3">Auto-Skip Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="skipEnabled"
                checked={skipSettings.enabled}
                onChange={(e) => setSkipSettings(prev => ({
                  ...prev,
                  enabled: e.target.checked
                }))}
                className="rounded"
              />
              <label htmlFor="skipEnabled" className="text-sm font-medium">
                Auto-Skip Enabled
              </label>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">
                Skip Duration (seconds)
              </label>
              <input
                type="number"
                min="1"
                max="30"
                value={skipSettings.skipDuration}
                onChange={(e) => setSkipSettings(prev => ({
                  ...prev,
                  skipDuration: parseInt(e.target.value) || 5
                }))}
                className="w-full px-2 py-1 border rounded text-sm"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">
                Confidence Threshold
              </label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={skipSettings.confidenceThreshold}
                onChange={(e) => setSkipSettings(prev => ({
                  ...prev,
                  confidenceThreshold: parseFloat(e.target.value)
                }))}
                className="w-full"
              />
              <div className="text-xs text-gray-600 text-center">
                {(skipSettings.confidenceThreshold * 100).toFixed(0)}%
              </div>
            </div>
            
            <div className="text-sm">
              <div className="font-medium">Skip History</div>
              <div className="text-gray-600">
                {skipHistory.length} skips performed
              </div>
            </div>
          </div>
        </div>
      )}

      {!videoSrc && !isUploading ? (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center bg-gray-50">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileUpload}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 mb-4"
          />
          <p className="text-gray-600">
            Select a video file to analyze and auto-skip NSFW content
          </p>
        </div>
      ) : isUploading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Uploading video...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Connection Status */}
          <div className={`p-3 rounded-lg text-sm font-medium ${
            isConnected
              ? "bg-green-50 border border-green-200 text-green-700"
              : "bg-yellow-50 border border-yellow-200 text-yellow-700"
          }`}>
            {isConnected
              ? `🟢 Connected - Auto-skip ${skipSettings.enabled ? 'ENABLED' : 'DISABLED'}`
              : "🟡 Connecting to processing server..."}
          </div>

          {/* Video Player with Overlay */}
          <div className="relative bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              className="w-full h-auto"
              preload="metadata"
              onLoadedMetadata={handleVideoLoaded}>
              Your browser does not support the video tag.
            </video>

            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0 pointer-events-none"
              style={{ zIndex: 10 }}
            />
          </div>

          {/* Current Classification Display */}
          {currentClassification && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 mb-2">
                Current Classification
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Label:</span>
                  <div className={`font-bold ${
                    currentClassification.is_nsfw ? "text-red-600" : "text-green-600"
                  }`}>
                    {currentClassification.label.toUpperCase()}
                  </div>
                </div>
                <div>
                  <span className="text-gray-600">Confidence:</span>
                  <div className="font-bold">
                    {(currentClassification.confidence * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <span className="text-gray-600">Timestamp:</span>
                  <div className="font-bold">
                    {currentClassification.timestamp.toFixed(1)}s
                  </div>
                </div>
                <div>
                  <span className="text-gray-600">Status:</span>
                  <div className={`font-bold ${isSkipping ? 'text-orange-600' : 'text-gray-600'}`}>
                    {isSkipping ? 'SKIPPING' : 'PLAYING'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Skip History */}
          {skipHistory.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 mb-2">
                Skip History ({skipHistory.length} skips)
              </h3>
              <div className="max-h-32 overflow-y-auto">
                {skipHistory.slice(-5).map((skip, index) => (
                  <div key={index} className="text-sm text-gray-600 mb-1">
                    {skip.fromTime.toFixed(1)}s → {skip.toTime.toFixed(1)}s 
                    ({skip.label}, {(skip.confidence * 100).toFixed(1)}%)
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Video Info */}
          {videoInfo && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 mb-2">
                Video Information
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Duration:</span>
                  <div className="font-bold">{videoInfo.duration.toFixed(1)}s</div>
                </div>
                <div>
                  <span className="text-gray-600">FPS:</span>
                  <div className="font-bold">{videoInfo.fps.toFixed(1)}</div>
                </div>
                <div>
                  <span className="text-gray-600">Total Frames:</span>
                  <div className="font-bold">{videoInfo.total_frames}</div>
                </div>
              </div>
            </div>
          )}

          {/* Classifications Summary */}
          {classifications.size > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 mb-2">
                Classifications ({classifications.size} processed)
              </h3>
              <div className="text-sm text-gray-600">
                {(() => {
                  const classArray = Array.from(classifications.values());
                  const nsfwCount = classArray.filter((c) => c.is_nsfw).length;
                  const normalCount = classArray.length - nsfwCount;
                  return `NSFW: ${nsfwCount} | Normal: ${normalCount}`;
                })()}
              </div>
            </div>
          )}

          {/* New Upload Button */}
          <div className="text-center">
            <button
              onClick={handleNewUpload}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors">
              Upload New Video
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;