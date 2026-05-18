@echo off
cd /d "C:\Users\Usuario\Desktop\Nova pasta (3)\App Wasabi\wasabi-crm"
node scripts\sync-wbuy.mjs >> logs\sync-wbuy-scheduler.log 2>&1
