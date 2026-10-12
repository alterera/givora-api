module.exports = {
  apps: [
    {
      name: 'givora-api',
      cwd: '/var/www/givora-api',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
  ],
};
