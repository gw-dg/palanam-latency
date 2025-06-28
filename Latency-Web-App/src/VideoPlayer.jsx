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

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastProcessedTime = useRef(-1);

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
    if (videoSrc && videoSrc.startsWith("blob:")) {
      URL.revokeObjectURL(videoSrc);
    }
    setIsConnected(false);
  }, [videoSrc]);

  // Real-time frame processing - only process frames as video plays
  const processCurrentFrame = useCallback(async () => {
    if (
      !videoRef.current ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const currentTime = videoRef.current.currentTime;
    const timeKey = Math.floor(currentTime * 2) / 2; // Process every 0.5 seconds

    // Only process if we haven't processed this time segment and video is playing
    if (!videoRef.current.paused && timeKey !== lastProcessedTime.current) {
      lastProcessedTime.current = timeKey;

      // Send current timestamp to backend for processing
      wsRef.current.send(
        JSON.stringify({
          type: "process_frame",
          timestamp: currentTime,
        })
      );
    }
  }, []);

  // Update overlay based on current video time
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

    // Find the most recent classification for current time
    const timeKey = Math.floor(currentTime * 2) / 2;
    let relevantClassification = null;

    // Look for classification within 1 second window
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

      // Draw text with outline
      ctx.strokeText(text, 20, 40);
      ctx.fillText(text, 20, 40);

      // Draw confidence bar
      const barWidth = 200;
      const barHeight = 8;
      const barX = 20;
      const barY = 50;

      // Background bar
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.fillRect(barX, barY, barWidth, barHeight);

      // Confidence bar
      ctx.fillStyle = is_nsfw ? "#ff4444" : "#44ff44";
      ctx.fillRect(barX, barY, barWidth * confidence, barHeight);
    }

    // Process current frame if video is playing
    processCurrentFrame();

    // Continue animation
    animationFrameRef.current = requestAnimationFrame(updateOverlay);
  }, [classifications, processCurrentFrame]);

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

      // Match canvas size to video size
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.style.width = video.offsetWidth + "px";
      canvas.style.height = video.offsetHeight + "px";
    }
  };

  // WebSocket message handler
  const handleWebSocketMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "video_info":
          setVideoInfo(data);
          console.log("Video info received:", data);
          break;

        case "classification":
          // Store classification by timestamp for quick lookup
          const timeKey = Math.floor(data.timestamp * 2) / 2;
          setClassifications((prev) => new Map(prev.set(timeKey, data)));
          console.log("Classification received:", data);
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
  }, []);

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
        // Send initial connection message
        ws.send(JSON.stringify({ type: "connect" }));
      };

      ws.onmessage = handleWebSocketMessage;

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setError(
          "WebSocket connection failed. Make sure the server is running."
        );
        setIsConnected(false);
      };

      ws.onclose = (event) => {
        console.log("WebSocket disconnected", event.code, event.reason);
        setIsConnected(false);

        // Attempt reconnection if it wasn't a clean close
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
    cleanup(); // Clean up previous session

    try {
      // Create local video URL for immediate playback
      const localVideoUrl = URL.createObjectURL(file);
      setVideoSrc(localVideoUrl);

      // Upload video to get session ID
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

      // Start WebSocket connection for real-time processing
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
        Real-time NSFW Video Detector
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
            Select a video file to analyze in real-time
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
          <div
            className={`p-3 rounded-lg text-sm font-medium ${
              isConnected
                ? "bg-green-50 border border-green-200 text-green-700"
                : "bg-yellow-50 border border-yellow-200 text-yellow-700"
            }`}>
            {isConnected
              ? "🟢 Connected - Real-time processing active"
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

            {/* Overlay Canvas */}
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
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Label:</span>
                  <div
                    className={`font-bold ${
                      currentClassification.is_nsfw
                        ? "text-red-600"
                        : "text-green-600"
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
                  <div className="font-bold">
                    {videoInfo.duration.toFixed(1)}s
                  </div>
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
