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

// Service client — bypasses RLS, used only for trusted backend
// operations like creating workspaces on a user's behalf
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)
console.log('Service key loaded:', process.env.SUPABASE_SERVICE_KEY ? 'YES, starts with ' + process.env.SUPABASE_SERVICE_KEY.slice(0, 15) : 'MISSING')
app.use(cors())
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

// Sign up a new user
app.post('/auth/signup', async (req, res) => {
  const { email, password, name, role } = req.body

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password
  })

  if (authError) {
    return res.status(400).json({ error: authError.message })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert({ id: authData.user.id, name, role: role || 'technician' })
    .select()
    .single()

  if (profileError) {
    return res.status(400).json({ error: profileError.message })
  }

  res.json({ message: 'Account created', user: profile })
})

// Log in an existing user
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    return res.status(400).json({ error: error.message })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single()

  res.json({
    message: 'Login successful',
    token: data.session.access_token,
    user: profile
  })
})

// Create a new workspace (a CCTV company account)
app.post('/workspaces', async (req, res) => {
  const { name, ownerId } = req.body

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('workspaces')
    .insert({ name, owner_id: ownerId })
    .select()
    .single()

  if (workspaceError) {
    return res.status(400).json({ error: workspaceError.message })
  }

  const { error: linkError } = await supabaseAdmin
    .from('workspace_users')
    .insert({ workspace_id: workspace.id, user_id: ownerId, role: 'owner' })

  if (linkError) {
    return res.status(400).json({ error: linkError.message })
  }

  res.json({ workspace })
})

// Create a new site within a workspace
app.post('/sites', async (req, res) => {
  const { name, address, workspaceId } = req.body

  const { data, error } = await supabaseAdmin
    .from('sites')
    .insert({ name, address, workspace_id: workspaceId })
    .select()
    .single()

  if (error) {
    return res.status(400).json({ error: error.message })
  }

  res.json({ site: data })
})

const ping = require('ping')

async function pingAllCameras() {
  const { data: cameras, error } = await supabase.from('cameras').select('*')

  if (error) {
    console.error('Error fetching cameras:', error.message)
    return
  }

  if (!cameras || cameras.length === 0) {
    console.log('No cameras to ping yet')
    return
  }

  for (const camera of cameras) {
    const result = await ping.promise.probe(camera.ip_address, { timeout: 5 })
    const isOnline = result.alive

    console.log(`${camera.name} (${camera.ip_address}): ${isOnline ? 'ONLINE' : 'OFFLINE'}`)

    if (camera.status !== (isOnline ? 'online' : 'offline')) {
  await supabaseAdmin
    .from('cameras')
    .update({ status: isOnline ? 'online' : 'offline' })
    .eq('id', camera.id)

  console.log(`Status changed for ${camera.name} → ${isOnline ? 'online' : 'offline'}`)

  if (!isOnline) {
    // Camera just went offline — create a fault record
    const { error: faultError } = await supabaseAdmin
      .from('faults')
      .insert({
        camera_id: camera.id,
        offline_since: new Date()
      })

    if (faultError) {
      console.error('Error creating fault:', faultError.message)
    } else {
      console.log(`Fault created for ${camera.name}`)
    }
  } else {
    // Camera just came back online — close the open fault
    const { data: openFault } = await supabaseAdmin
      .from('faults')
      .select('*')
      .eq('camera_id', camera.id)
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (openFault) {
      const offlineSince = new Date(openFault.offline_since)
      const resolvedAt = new Date()
      const downtimeMinutes = Math.round((resolvedAt - offlineSince) / 1000 / 60)

      await supabaseAdmin
        .from('faults')
        .update({
          resolved_at: resolvedAt,
          downtime_minutes: downtimeMinutes
        })
        .eq('id', openFault.id)

      console.log(`Fault resolved for ${camera.name} — downtime: ${downtimeMinutes} min`)
    }
  }
}
  }
}

setInterval(pingAllCameras, 30000)
pingAllCameras()

app.listen(PORT, () => {
  console.log(`CamPulse backend running on port ${PORT}`)
})

// GET routes
app.get('/workspaces', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('workspaces')
    .select('*')

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

app.get('/sites', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('sites')
    .select('*')

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})

app.get('/cameras', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('cameras')
    .select('*')

  if (error) return res.status(400).json({ error: error.message })
  res.json(data)
})