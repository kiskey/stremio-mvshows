# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install --omit=dev

# Copy the rest of the application's code to the working directory
COPY src/ ./src/

# Make port available
EXPOSE 3000

# Run the app when the container launches
CMD ["node", "src/index.js"]
