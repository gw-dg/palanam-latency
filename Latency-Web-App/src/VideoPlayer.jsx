import React, { useState, useRef } from "react";

const VideoPlayer = () => {
  const [videoSrc, setVideoSrc] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleProcessVideo = async (file) => {
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("http://localhost:8000/process-video/", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setVideoSrc(url);
    } catch (error) {
      console.error("Error processing video:", error);
      alert("Error processing video. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith("video/")) {
      // Clear any existing video URL
      if (videoSrc) {
        URL.revokeObjectURL(videoSrc);
        setVideoSrc(null);
      }

      // Process the uploaded video
      handleProcessVideo(file);
    } else {
      alert("Please select a valid video file.");
    }
  };

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleUploadClick = () => {
    // Reset the input value to allow re-uploading the same file
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleNewUpload = () => {
    // Clear current video and show upload area
    if (videoSrc) {
      URL.revokeObjectURL(videoSrc);
    }
    setVideoSrc(null);
    setIsPlaying(false);
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>NSFW Video Content Detector</h1>

      {!videoSrc && !isProcessing ? (
        <div style={styles.uploadArea} onClick={handleUploadClick}>
          <div style={styles.uploadIcon}>📹</div>
          <p style={styles.uploadText}>Click to upload video</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileUpload}
            style={styles.hiddenInput}
          />
        </div>
      ) : isProcessing ? (
        <div style={styles.processingArea}>
          <div style={styles.spinner}></div>
          <p style={styles.processingText}>Processing video...</p>
          <p style={styles.processingSubtext}>This may take a few moments</p>
        </div>
      ) : (
        <div style={styles.videoContainer}>
          <video
            ref={videoRef}
            src={videoSrc}
            style={styles.video}
            controls
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
          <div style={styles.controls}>
            <button style={styles.playButton} onClick={handlePlayPause}>
              {isPlaying ? "⏸️" : "▶️"}
            </button>
            <button style={styles.uploadButton} onClick={handleNewUpload}>
              Upload New Video
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    maxWidth: "800px",
    margin: "0 auto",
    padding: "20px",
    fontFamily: "Arial, sans-serif",
  },
  title: {
    textAlign: "center",
    marginBottom: "30px",
    color: "#333",
  },
  uploadArea: {
    border: "3px dashed #ccc",
    borderRadius: "12px",
    padding: "60px 20px",
    textAlign: "center",
    cursor: "pointer",
    backgroundColor: "#fafafa",
    transition: "all 0.3s ease",
  },
  processingArea: {
    border: "2px solid #007bff",
    borderRadius: "12px",
    padding: "60px 20px",
    textAlign: "center",
    backgroundColor: "#f8f9fa",
  },
  spinner: {
    width: "40px",
    height: "40px",
    border: "4px solid #f3f3f3",
    borderTop: "4px solid #007bff",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
    margin: "0 auto 20px",
  },
  processingText: {
    fontSize: "18px",
    color: "#333",
    margin: "0 0 10px 0",
    fontWeight: "bold",
  },
  processingSubtext: {
    fontSize: "14px",
    color: "#666",
    margin: "0",
  },
  uploadIcon: {
    fontSize: "48px",
    marginBottom: "15px",
  },
  uploadText: {
    fontSize: "18px",
    color: "#666",
    margin: "0",
  },
  hiddenInput: {
    display: "none",
  },
  videoContainer: {
    backgroundColor: "#000",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: "0 4px 15px rgba(0,0,0,0.2)",
  },
  video: {
    width: "100%",
    height: "auto",
    display: "block",
  },
  controls: {
    padding: "15px",
    backgroundColor: "#333",
    display: "flex",
    gap: "10px",
    alignItems: "center",
  },
  playButton: {
    backgroundColor: "#007bff",
    color: "white",
    border: "none",
    padding: "10px 15px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "16px",
  },
  uploadButton: {
    backgroundColor: "#28a745",
    color: "white",
    border: "none",
    padding: "10px 15px",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "14px",
    marginLeft: "auto",
  },
};

// Add CSS animation for spinner
const styleSheet = document.createElement("style");
styleSheet.type = "text/css";
styleSheet.innerText = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);

export default VideoPlayer;
