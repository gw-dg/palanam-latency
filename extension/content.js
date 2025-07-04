// content.js - Main content script for video detection and processing
class NSFWVideoSkipper {
    constructor() {
      this.isEnabled = false;
      this.settings = {
        enabled: true,
        skipDuration: 5,
        confidenceThreshold: 0.7,
        bufferTime: 1.0,
        serverUrl: 'ws://localhost:8000'
      };
      this.processedVideos = new Set();
      this.videoProcessors = new Map();
      this.observer = null;
      this.init();
    }
  
    async init() {
      console.log('NSFW Video Skipper: Initializing...');
      
      // Load settings
      await this.loadSettings();
      
      // Set up mutation observer for dynamic content
      this.setupObserver();
      
      // Process existing videos
      this.processExistingVideos();
      
      // Listen for settings changes
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleMessage(message, sender, sendResponse);
      });
      
      console.log('NSFW Video Skipper: Initialized');
    }
  
    async loadSettings() {
      try {
        const result = await chrome.storage.local.get(['nsfwSkipperSettings']);
        if (result.nsfwSkipperSettings) {
          this.settings = { ...this.settings, ...result.nsfwSkipperSettings };
        }
        this.isEnabled = this.settings.enabled;
        console.log('Settings loaded:', this.settings);
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    }
  
    async saveSettings() {
      try {
        await chrome.storage.local.set({ nsfwSkipperSettings: this.settings });
        console.log('Settings saved:', this.settings);
      } catch (error) {
        console.error('Failed to save settings:', error);
      }
    }
  
    setupObserver() {
      this.observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if the added node is a video or contains videos
              this.processVideoElement(node);
              
              // Check for videos in the added subtree
              const videos = node.querySelectorAll('video');
              videos.forEach(video => this.processVideoElement(video));
            }
          });
        });
      });
  
      this.observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  
    processExistingVideos() {
      const videos = document.querySelectorAll('video');
      videos.forEach(video => this.processVideoElement(video));
    }
  
    processVideoElement(video) {
      if (!(video instanceof HTMLVideoElement)) return;
      if (this.processedVideos.has(video)) return;
      if (!this.isEnabled) return;
  
      // Skip very small videos (likely thumbnails or ads)
      if (video.videoWidth < 200 || video.videoHeight < 150) return;
  
      console.log('Processing new video element:', video);
      
      this.processedVideos.add(video);
      
      // Create video processor
      const processor = new VideoProcessor(video, this.settings);
      this.videoProcessors.set(video, processor);
      
      // Initialize processing
      processor.initialize();
      
      // Clean up when video is removed
      video.addEventListener('remove', () => {
        this.cleanupVideo(video);
      });
    }
  
    cleanupVideo(video) {
      if (this.videoProcessors.has(video)) {
        this.videoProcessors.get(video).cleanup();
        this.videoProcessors.delete(video);
      }
      this.processedVideos.delete(video);
    }
  
    handleMessage(message, sender, sendResponse) {
      switch (message.type) {
        case 'updateSettings':
          this.settings = { ...this.settings, ...message.settings };
          this.isEnabled = this.settings.enabled;
          this.saveSettings();
          
          // Update all active processors
          this.videoProcessors.forEach(processor => {
            processor.updateSettings(this.settings);
          });
          
          sendResponse({ success: true });
          break;
          
        case 'getStatus':
          sendResponse({
            isEnabled: this.isEnabled,
            activeVideos: this.videoProcessors.size,
            settings: this.settings
          });
          break;
          
        case 'toggleEnabled':
          this.isEnabled = !this.isEnabled;
          this.settings.enabled = this.isEnabled;
          this.saveSettings();
          
          if (this.isEnabled) {
            this.processExistingVideos();
          } else {
            // Cleanup all processors
            this.videoProcessors.forEach(processor => processor.cleanup());
            this.videoProcessors.clear();
            this.processedVideos.clear();
          }
          
          sendResponse({ isEnabled: this.isEnabled });
          break;
      }
    }
  }
  
  // Video processor class for individual videos
  class VideoProcessor {
    constructor(video, settings) {
      this.video = video;
      this.settings = settings;
      this.canvas = null;
      this.overlay = null;
      this.ws = null;
      this.sessionId = null;
      this.isProcessing = false;
      this.isSkipping = false;
      this.lastProcessedTime = -1;
      this.classifications = new Map();
      this.skipHistory = [];
      this.frameInterval = null;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 5;
    }
  
    async initialize() {
      console.log('Initializing video processor for:', this.video.src);
      
      // Create overlay elements
      this.createOverlay();
      
      // Set up video event listeners
      this.setupVideoListeners();
      
      // Connect to processing server
      await this.connectToServer();
      
      // Start frame processing
      this.startFrameProcessing();
    }
  
    createOverlay() {
      // Create canvas overlay
      this.canvas = document.createElement('canvas');
      this.canvas.style.position = 'absolute';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.pointerEvents = 'none';
      this.canvas.style.zIndex = '9999';
      this.canvas.style.backgroundColor = 'transparent';
      
      // Create overlay container
      this.overlay = document.createElement('div');
      this.overlay.style.position = 'absolute';
      this.overlay.style.top = '0';
      this.overlay.style.left = '0';
      this.overlay.style.width = '100%';
      this.overlay.style.height = '100%';
      this.overlay.style.pointerEvents = 'none';
      this.overlay.style.zIndex = '9998';
      
      // Position overlay relative to video
      this.updateOverlayPosition();
      
      // Add to DOM
      const videoParent = this.video.parentElement;
      if (videoParent) {
        const videoRect = this.video.getBoundingClientRect();
        this.overlay.style.width = videoRect.width + 'px';
        this.overlay.style.height = videoRect.height + 'px';
        
        videoParent.appendChild(this.overlay);
        this.overlay.appendChild(this.canvas);
      }
      
      // Update overlay on resize
      window.addEventListener('resize', () => this.updateOverlayPosition());
    }
  
    updateOverlayPosition() {
      if (!this.video || !this.overlay) return;
      
      const videoRect = this.video.getBoundingClientRect();
      const videoStyle = getComputedStyle(this.video);
      
      // Position overlay exactly over video
      this.overlay.style.left = videoRect.left + 'px';
      this.overlay.style.top = videoRect.top + 'px';
      this.overlay.style.width = videoRect.width + 'px';
      this.overlay.style.height = videoRect.height + 'px';
      
      // Update canvas size
      if (this.canvas) {
        this.canvas.width = videoRect.width;
        this.canvas.height = videoRect.height;
        this.canvas.style.width = videoRect.width + 'px';
        this.canvas.style.height = videoRect.height + 'px';
      }
    }
  
    setupVideoListeners() {
      this.video.addEventListener('loadedmetadata', () => {
        this.updateOverlayPosition();
      });
      
      this.video.addEventListener('play', () => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.startFrameProcessing();
        }
      });
      
      this.video.addEventListener('pause', () => {
        this.stopFrameProcessing();
      });
      
      this.video.addEventListener('seeked', () => {
        this.lastProcessedTime = -1;
      });
    }
  
    async connectToServer() {
      try {
        // Generate session ID
        this.sessionId = 'web_' + Math.random().toString(36).substr(2, 9);
        
        // Connect WebSocket
        const wsUrl = `${this.settings.serverUrl.replace('http', 'ws')}/ws/${this.sessionId}`;
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
          console.log('WebSocket connected for video processor');
          this.reconnectAttempts = 0;
          this.ws.send(JSON.stringify({
            type: 'connect',
            source: 'web_extension',
            video_src: this.video.src
          }));
        };
        
        this.ws.onmessage = (event) => {
          this.handleServerMessage(JSON.parse(event.data));
        };
        
        this.ws.onclose = () => {
          console.log('WebSocket disconnected for video processor');
          this.handleDisconnection();
        };
        
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
        
      } catch (error) {
        console.error('Failed to connect to server:', error);
      }
    }
  
    handleDisconnection() {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        
        setTimeout(() => {
          this.connectToServer();
        }, 2000 * this.reconnectAttempts);
      } else {
        console.error('Max reconnection attempts reached');
        this.showError('Connection to processing server lost');
      }
    }
  
    handleServerMessage(data) {
      switch (data.type) {
        case 'classification':
          this.handleClassification(data);
          break;
        case 'connection_established':
          console.log('Server connection established');
          break;
        case 'error':
          console.error('Server error:', data.message);
          this.showError(data.message);
          break;
      }
    }
  
    handleClassification(classification) {
      const { timestamp, confidence, label, is_nsfw } = classification;
      
      // Store classification
      const timeKey = Math.floor(timestamp * 2) / 2;
      this.classifications.set(timeKey, classification);
      
      // Update overlay
      this.updateOverlayDisplay(classification);
      
      // Handle auto-skip
      if (is_nsfw && this.settings.enabled && confidence > this.settings.confidenceThreshold) {
        this.skipNSFWContent(classification);
      }
    }
  
    skipNSFWContent(classification) {
      if (this.isSkipping) return;
      
      this.isSkipping = true;
      const currentTime = this.video.currentTime;
      const skipToTime = Math.min(
        currentTime + this.settings.skipDuration,
        this.video.duration - 1
      );
      
      // Record skip
      this.skipHistory.push({
        fromTime: currentTime,
        toTime: skipToTime,
        timestamp: new Date().toISOString(),
        confidence: classification.confidence,
        label: classification.label
      });
      
      // Perform skip
      this.video.currentTime = skipToTime;
      
      // Show skip overlay
      this.showSkipOverlay();
      
      // Reset skipping state
      setTimeout(() => {
        this.isSkipping = false;
      }, 1000);
      
      console.log(`Skipped NSFW content: ${currentTime.toFixed(1)}s → ${skipToTime.toFixed(1)}s`);
    }
  
    updateOverlayDisplay(classification) {
      if (!this.canvas) return;
      
      const ctx = this.canvas.getContext('2d');
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      
      if (this.isSkipping) {
        this.drawSkipOverlay(ctx);
      } else {
        this.drawClassificationOverlay(ctx, classification);
      }
    }
  
    drawSkipOverlay(ctx) {
      // Black overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      
      // Skip text
      ctx.font = 'bold 24px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      
      const text = 'SKIPPING NSFW CONTENT';
      const centerX = this.canvas.width / 2;
      const centerY = this.canvas.height / 2;
      
      ctx.fillText(text, centerX, centerY);
      
      // Loading spinner
      const angle = (Date.now() / 100) % (2 * Math.PI);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(centerX, centerY + 40, 20, angle, angle + Math.PI * 1.5);
      ctx.stroke();
    }
  
    drawClassificationOverlay(ctx, classification) {
      const { label, confidence, is_nsfw } = classification;
      
      // Classification text
      ctx.font = 'bold 16px Arial';
      ctx.fillStyle = is_nsfw ? '#ff4444' : '#44ff44';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.textAlign = 'left';
      
      const text = `${label.toUpperCase()} (${(confidence * 100).toFixed(1)}%)`;
      
      ctx.strokeText(text, 10, 25);
      ctx.fillText(text, 10, 25);
      
      // Confidence bar
      const barWidth = 150;
      const barHeight = 6;
      const barX = 10;
      const barY = 35;
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      
      ctx.fillStyle = is_nsfw ? '#ff4444' : '#44ff44';
      ctx.fillRect(barX, barY, barWidth * confidence, barHeight);
    }
  
    showSkipOverlay() {
      // Implementation for showing skip notification
      this.updateOverlayDisplay({ label: 'skipping', confidence: 1, is_nsfw: true });
    }
  
    showError(message) {
      console.error('Video Processor Error:', message);
      // Could show error in overlay
    }
  
    startFrameProcessing() {
      if (this.frameInterval) return;
      
      this.frameInterval = setInterval(() => {
        if (!this.video.paused && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.processCurrentFrame();
        }
      }, 500); // Process every 500ms
    }
  
    stopFrameProcessing() {
      if (this.frameInterval) {
        clearInterval(this.frameInterval);
        this.frameInterval = null;
      }
    }
  
    processCurrentFrame() {
      if (this.isSkipping) return;
      
      const currentTime = this.video.currentTime;
      const timeKey = Math.floor(currentTime * 2) / 2;
      
      if (timeKey !== this.lastProcessedTime) {
        this.lastProcessedTime = timeKey;
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'process_frame',
            timestamp: currentTime,
            video_src: this.video.src
          }));
        }
      }
    }
  
    updateSettings(newSettings) {
      this.settings = { ...this.settings, ...newSettings };
      console.log('Updated processor settings:', this.settings);
    }
  
    cleanup() {
      console.log('Cleaning up video processor');
      
      // Stop frame processing
      this.stopFrameProcessing();
      
      // Close WebSocket
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      
      // Remove overlay
      if (this.overlay && this.overlay.parentElement) {
        this.overlay.parentElement.removeChild(this.overlay);
      }
      
      // Clear data
      this.classifications.clear();
      this.skipHistory = [];
    }
  }
  
  // Initialize the extension
  const nsfwSkipper = new NSFWVideoSkipper();