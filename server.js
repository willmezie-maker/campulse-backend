const express = require('express')
const cors = require('cors')
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const app = express()
const PORT = process.env.PORT || 3000

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'CamPulse API running', status: 'online' })
})

app.get('/cameras', async (req, res) => {
  const { data, error } = await supabase.from('cameras').select('*')

  if (error) {
    return res.status(400).json({ error: error.message })
  }

  res.json({ cameras: data })
})

app.listen(PORT, () => {
  console.log(`CamPulse backend running on port ${PORT}`)
})