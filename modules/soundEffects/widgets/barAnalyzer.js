
class BarAnalyzer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        
        // Constants
        this.COLUMN_WIDTH = 4;
        this.SPACING = 1;
        this.ROOF_HOLD = 32;
        this.FALL_DIVISOR = 20;
        
        // State
        this.bars = [];
        this.roofs = [];
        this.roofVelocities = [];
        this.bandCount = 0;
        
        // Colors
        this.baseColor = { r: 0, g: 217, b: 255 }; // Default accent
        this.psychedelic = false;
        
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }
    
    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        
        this.init();
    }
    
    init() {
        // Calculate number of bands that fit
        this.bandCount = Math.floor(this.width / (this.COLUMN_WIDTH + this.SPACING));
        if (this.bandCount < 1) this.bandCount = 1;
        
        // Reset state arrays
        this.bars = new Float32Array(this.bandCount).fill(0);
        this.roofs = new Float32Array(this.bandCount).fill(0);
        this.roofVelocities = new Uint32Array(this.bandCount).fill(this.ROOF_HOLD); // Initialize as holding
        
        this.createGradient();
    }
    
    createGradient() {
        this.gradient = this.ctx.createLinearGradient(0, this.height, 0, 0);
        // Bottom color (faded)
        this.gradient.addColorStop(0, `rgba(${this.baseColor.r}, ${this.baseColor.g}, ${this.baseColor.b}, 0.2)`);
        // Mid color
        this.gradient.addColorStop(0.6, `rgba(${this.baseColor.r}, ${this.baseColor.g}, ${this.baseColor.b}, 0.8)`);
        // Top color (bright)
        this.gradient.addColorStop(1, '#ffffff');
    }
    
    setColor(r, g, b) {
        this.baseColor = { r, g, b };
        this.createGradient();
    }
    
    /**
     * Draw the frame
     * @param {Uint8Array} frequencyData - Array of 0-255 values
     */
    draw(frequencyData) {
        // Clear background
        this.ctx.fillStyle = '#12121a'; // Match --bg-medium
        this.ctx.fillRect(0, 0, this.width, this.height);
        
        if (!frequencyData) return;
        
        // Interpolation step could go here if data length != bandCount
        // For now, simple sampling
        const step = Math.floor(frequencyData.length / this.bandCount);
        
        // Physics Loop
        const maxBarHeight = this.height - 2; // Leave room for roof
        
        for (let i = 0; i < this.bandCount; i++) {
            // Get data value (simple average or peak sample)
            let val = 0;
            // Sampling strategy: Peak in range
            for (let j = 0; j < step; j++) {
                const sample = frequencyData[i * step + j] || 0;
                if (sample > val) val = sample;
            }
            
            // Map 0-255 to height
            const targetHeight = (val / 255) * maxBarHeight;
            
            // Smooth bars (optional, but good for FPS independence)
            // Just set directly for responsiveness as per original C++ code mostly doing direct mapping
            this.bars[i] = targetHeight;
            
            // Roof Physics
            if (this.bars[i] > this.roofs[i]) {
                this.roofs[i] = this.bars[i];
                this.roofVelocities[i] = 0; // Reset velocity (start hold)
            } else {
                // Falling logic
                if (this.roofVelocities[i] > this.ROOF_HOLD) {
                    // Fall
                    const velocity = (this.roofVelocities[i] - this.ROOF_HOLD);
                    const drop = velocity / this.FALL_DIVISOR; // Slow fall at first, accelerates
                    this.roofs[i] -= drop * 2; // Speed up a bit for high FPS
                    
                    if (this.roofs[i] < 0) this.roofs[i] = 0;
                }
                
                // Increment velocity counter
                this.roofVelocities[i]++;
            }
            
            // Drawing
            const x = i * (this.COLUMN_WIDTH + this.SPACING);
            
            // Draw Bar
            if (this.bars[i] > 0) {
                this.ctx.fillStyle = this.gradient;
                this.ctx.fillRect(
                    x, 
                    this.height - this.bars[i], 
                    this.COLUMN_WIDTH, 
                    this.bars[i]
                );
            }
            
            // Draw Roof
            if (this.roofs[i] > 0) {
                this.ctx.fillStyle = '#ffffff';
                // Roof is a single pixel line or small block
                this.ctx.fillRect(
                    x,
                    this.height - this.roofs[i] - 2,
                    this.COLUMN_WIDTH,
                    1
                );
            }
        }
    }
}

// Export for usage
if (typeof module !== 'undefined') {
    module.exports = BarAnalyzer;
} else {
    window.BarAnalyzer = BarAnalyzer;
}
